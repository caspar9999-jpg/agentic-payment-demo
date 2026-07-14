import { x402Client as X402SDKClient, x402HTTPClient as X402HTTP } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { recoverTypedDataAddress } from "viem";

const X402_BASE = "/x402";
const BAZAAR_BASE = "/bazaar";

let _paymentClient = null;
let _httpClient = null;

function b64encode(obj) {
  return typeof btoa === "function" ? btoa(JSON.stringify(obj)) : Buffer.from(JSON.stringify(obj)).toString("base64");
}

export function setTestPaymentClient(client) {
  _paymentClient = client;
  _httpClient = {
    encodePaymentSignatureHeader: (payload) => ({ "PAYMENT-SIGNATURE": b64encode(payload) }),
  };
  return () => { _paymentClient = null; _httpClient = null; };
}
export function initPaymentClient(accountAddress) {
  if (!accountAddress || typeof accountAddress !== "string") {
    console.error("[x402] initPaymentClient called with invalid address:", accountAddress);
    return;
  }
  console.log("[x402] Initializing payment client for", accountAddress.slice(0, 10) + "...");

  const BASE_SEPOLIA_CHAIN_ID = "0x14a34";

  const signer = {
    address: accountAddress,
    signTypedData: async (args) => {
      const currentChain = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
      if (currentChain !== BASE_SEPOLIA_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
          });
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          if (e.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: BASE_SEPOLIA_CHAIN_ID,
                chainName: "Base Sepolia",
                rpcUrls: ["https://sepolia.base.org"],
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                blockExplorerUrls: ["https://sepolia.basescan.org"],
              }],
            });
          } else {
            throw e;
          }
        }
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const signingAddr = accounts[0].toLowerCase();

      const types = { ...args.types };
      if (!types.EIP712Domain) {
        const domainKeys = Object.keys(args.domain);
        types.EIP712Domain = domainKeys.map(k => ({
          name: k,
          type: k === "verifyingContract" ? "address" : k === "chainId" ? "uint256" : typeof args.domain[k] === "number" ? "uint256" : "string",
        }));
      }

      const serialized = JSON.stringify({ ...args, types }, (_, v) => typeof v === "bigint" ? v.toString() : v);

      console.group("[x402 debug] signTypedData");
      console.log("signer.address:", accountAddress.toLowerCase());
      console.log("MetaMask selected account:", signingAddr);
      console.log("domain:", JSON.stringify(args.domain, null, 2));
      console.log("primaryType:", args.primaryType);
      console.log("message:", JSON.stringify(args.message, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
      console.log("EIP712Domain added:", !args.types?.EIP712Domain);
      console.groupEnd();

      const sig = await window.ethereum.request({
        method: "eth_signTypedData_v4",
        params: [accounts[0], serialized],
      });

      try {
        const recovered = await recoverTypedDataAddress({ ...args, types, signature: sig });
        if (recovered.toLowerCase() === accountAddress.toLowerCase()) {
          return sig;
        }
        console.warn("[x402 debug] Signature recovered to wrong address:", recovered, "expected:", accountAddress.toLowerCase());
        const sigBytes = sig.replace("0x", "");
        const r = "0x" + sigBytes.slice(0, 64);
        const s = "0x" + sigBytes.slice(64, 128);
        const v = parseInt(sigBytes.slice(128, 130), 16);
        const flipV = v === 27 ? 28 : v === 28 ? 27 : v === 0 ? 1 : v === 1 ? 0 : v;
        const fixedSig = r + s.slice(2) + flipV.toString(16).padStart(2, "0");
        const recovered2 = await recoverTypedDataAddress({ ...args, types, signature: fixedSig });
        if (recovered2.toLowerCase() === accountAddress.toLowerCase()) {
          console.log("[x402 debug] Fixed v value:", v, "->", flipV);
          return fixedSig;
        }
        console.warn("[x402 debug] Flipping v also failed. recovered:", recovered2);
        console.warn("[x402 debug] mm account:", signingAddr, "signer addr:", accountAddress.toLowerCase());
      } catch (e) {
        console.warn("[x402 debug] Signature recovery error:", e.message);
      }

      return sig;
    },
  };

  const client = new X402SDKClient();
  registerExactEvmScheme(client, {
    signer,
    networks: ["eip155:84532"],
  });

  _paymentClient = client;
  _httpClient = new X402HTTP(client);
}

export function resetPaymentClient() {
  _paymentClient = null;
  _httpClient = null;
}

function base64Decode(str) {
  if (typeof atob === "function") return JSON.parse(atob(str));
  return JSON.parse(Buffer.from(str, "base64").toString("utf-8"));
}

async function fetchJson(url, options) {
  const res = options ? await fetch(url, options) : await fetch(url);
  const data = await res.json();
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

function errorMessage(status, data, settlementResponse) {
  if (settlementResponse?.error) return settlementResponse.error;
  if (settlementResponse?.errorReason) return settlementResponse.errorReason;
  if (data?.error) return data.error;
  if (data?.settlementResponse?.error) return data.settlementResponse.error;
  if (data?.message) return data.message;
  if (status === 404) return "Product not registered";
  if (status === 502) return `Facilitator error: ${data?.message || data?.error || "unknown"}`;
  return "Payment failed";
}

export const x402Client = {
  async accessResource(productId) {
    let result;
    try {
      result = await fetchJson(`${X402_BASE}/resource/${productId}`);
    } catch (e) {
      return { status: "error", error: `Cannot reach x402 server: ${e.message}` };
    }
    const { status, ok, data, headers } = result;
    if (status === 402 && headers.get("PAYMENT-REQUIRED")) {
      const paymentRequired = base64Decode(headers.get("PAYMENT-REQUIRED"));
      return { status: "payment_required", paymentRequired };
    }
    const paymentResponse = headers.get("PAYMENT-RESPONSE")
      ? base64Decode(headers.get("PAYMENT-RESPONSE"))
      : null;
    return {
      status: ok ? "paid" : "payment_failed",
      data,
      settlementResponse: paymentResponse,
      error: ok ? null : errorMessage(status, data, paymentResponse),
    };
  },

  async payForResource(productId) {
    if (!_paymentClient || !_httpClient) {
      return { status: "error", error: "MetaMask not connected. Connect your wallet first." };
    }

    const access = await this.accessResource(productId);
    if (access.status !== "payment_required") return access;

    let payload;
    try {
      payload = await _paymentClient.createPaymentPayload(access.paymentRequired);
      console.log("[x402 debug] PaymentPayload created:");
      console.log("  x402Version:", payload.x402Version);
      console.log("  paymentId:", payload.paymentId);
      console.log("  accepted:", JSON.stringify(payload.accepted, null, 4));
      console.log("  payload.authorization:", JSON.stringify(payload.payload?.authorization, null, 4));
      console.log("  payload.signature:", payload.payload?.signature);
      console.log("  signerAddress:", payload.signerAddress || payload.payload?.authorization?.from);
    } catch (e) {
      console.error("[x402] Failed to create payment payload:", e);
      return { status: "error", error: `Failed to create payment: ${e.message}` };
    }

    const headers = _httpClient.encodePaymentSignatureHeader(payload);
    console.log("[x402 debug] PAYMENT-SIGNATURE header:", JSON.stringify(headers).slice(0, 80) + "...");

    let res;
    try {
      res = await fetch(`${X402_BASE}/resource/${productId}`, { headers });
    } catch (e) {
      return { status: "error", error: `Cannot reach x402 server: ${e.message}` };
    }

    const data = await res.json();
    console.log("[x402 debug] Server response:", res.status, JSON.stringify(data).slice(0, 200));
    const paymentResponse = res.headers.get("PAYMENT-RESPONSE")
      ? base64Decode(res.headers.get("PAYMENT-RESPONSE"))
      : null;

    if (res.ok) {
      return {
        status: "purchased",
        data,
        settlementResponse: paymentResponse,
        paymentId: payload.paymentId,
      };
    }
    return {
      status: "payment_failed",
      data,
      settlementResponse: paymentResponse,
      error: errorMessage(res.status, data, paymentResponse),
    };
  },

  async getMerchantBalances(rangeHours) {
    const qs = rangeHours ? `?rangeHours=${rangeHours}` : "";
    const { data } = await fetchJson(`${X402_BASE}/merchants${qs}`);
    return data.merchants || [];
  },

  async getMerchant(merchantId, rangeHours) {
    const qs = rangeHours ? `?rangeHours=${rangeHours}` : "";
    const { data } = await fetchJson(`${X402_BASE}/merchant/${merchantId}${qs}`);
    return data;
  },
};

function productIdFromResourceUrl(url) {
  const match = url.match(/\/resource\/([^/]+)$/);
  return match ? match[1] : null;
}

export async function discoverProducts(query = "all") {
  try {
    const url = query && query !== "all"
      ? `${BAZAAR_BASE}/discovery/resources/search?q=${encodeURIComponent(query)}`
      : `${BAZAAR_BASE}/discovery/resources`;
    const res = await fetch(url);
    if (!res.ok) return { products: [], total: 0 };
    const data = await res.json();
    const resources = data.resources || [];

    const products = resources.map(r => {
      const accept = r.accepts?.[0] || {};
      const pid = r.extensions?.bazaar?.info?.input?.pathParams?.productId
        || productIdFromResourceUrl(r.resource)
        || "unknown";
      const priceStr = accept.price || "$0.00";
      const priceCents = parseInt(priceStr.replace(/[$.]/g, ""), 10) || 0;
      return {
        id: pid,
        name: r.description?.split(" — ")[0] || pid,
        description: r.description || "",
        payment_url: r.resource,
        price: priceStr,
        priceInCents: priceCents,
        payment: accept,
      };
    });

    return { products, total: products.length };
  } catch (e) {
    console.error("Bazaar discovery failed:", e.message);
    return { products: [], total: 0 };
  }
}

const PRODUCT_KNOWLEDGE = {
  espresso: { caffeine: true, electrolytes: false, category: "coffee", temp: "hot", tags: ["bold", "concentrated"] },
  latte: { caffeine: true, electrolytes: false, category: "coffee", temp: "hot", tags: ["creamy", "milky", "protein"] },
  cappuccino: { caffeine: true, electrolytes: false, category: "coffee", temp: "hot", tags: ["foamy", "creamy"] },
  "cold-brew": { caffeine: true, electrolytes: false, category: "coffee", temp: "cold", tags: ["smooth", "refreshing"] },
  coke: { caffeine: true, electrolytes: false, category: "soda", temp: "cold", tags: ["classic", "carbonated"] },
  pepsi: { caffeine: true, electrolytes: false, category: "soda", temp: "cold", tags: ["sweet", "carbonated"] },
  sprite: { caffeine: false, electrolytes: false, category: "soda", temp: "cold", tags: ["crisp", "lemon-lime", "carbonated"] },
  fanta: { caffeine: false, electrolytes: false, category: "soda", temp: "cold", tags: ["fruity", "orange", "carbonated"] },
  dasani: { caffeine: false, electrolytes: false, category: "water", temp: "cold", tags: ["pure", "hydration"] },
  smartwater: { caffeine: false, electrolytes: true, category: "water", temp: "cold", tags: ["electrolytes", "hydration", "vapor-distilled"] },
};

function matchesPattern(text, pattern) {
  const hasWordBoundary = /^[\w-]+$/.test(pattern);
  return hasWordBoundary
    ? new RegExp(`\\b${pattern.replace(/-/g, '\\-')}\\b`, 'i').test(text)
    : text.includes(pattern);
}

const SCENARIOS = [
  {
    id: "post_sport",
    patterns: ["workout", "exercise", "gym", "sport", "running", "after sport", "post-workout", "post workout", "just finished", "training", "fitness", "cardio"],
    description: "post-exercise recovery",
    needs: { hydration: 10, electrolytes: 8, calories_for_recovery: 5, caffeine: -3, heavy: -2 },
  },
  {
    id: "need_energy",
    patterns: ["tired", "energy", "sleepy", "wake up", "need a boost", "groggy", "sluggish", "exhausted", "drained", "fatigue", "lethargic", "low energy"],
    description: "needing an energy boost",
    needs: { caffeine: 10, sugar: 7, light: 3, hydration: -1 },
  },
  {
    id: "hot_thirsty",
    patterns: ["very hot", "so hot", "warm", "sunny", "summer", "heat wave", "sweating", "dehydrated", "scorching", "humid"],
    description: "hot or thirsty",
    needs: { cold: 10, hydration: 9, light: 5, caffeine: -2, heavy: -5 },
  },
  {
    id: "hungry",
    patterns: ["hungry", "snack", "lunch break", "meal", "food", "appetite", "starving"],
    description: "looking for something with calories",
    needs: { calories: 8, satisfying: 5, light: -2 },
  },
];

const SCENARIO_INTROS = {
  post_sport: (name) => `Great — after ${name || "a workout"}, hydration and recovery are key! Here's what I'd recommend:`,
  need_energy: (name) => `Need ${name || "an energy boost"}? Here are the best picks to wake you up:`,
  hot_thirsty: (name) => `Perfect for a ${name || "hot day"}! Here are some refreshing options:`,
  hungry: (name) => `Feeling ${name || "hungry"}? These will hit the spot:`,
};

function getProductCalories(pid, products) {
  const p = products.find(x => x.id === pid);
  return p?.calories ?? 0;
}

function scoreProduct(pid, needs, products) {
  const info = PRODUCT_KNOWLEDGE[pid];
  if (!info) return 0;
  let score = 0;
  if (needs.hydration && info.category === "water") score += needs.hydration;
  if (needs.electrolytes && info.electrolytes) score += needs.electrolytes;
  if (needs.caffeine !== undefined) score += info.caffeine ? needs.caffeine : 0;
  if (needs.cold && info.temp === "cold") score += needs.cold;
  if (needs.sugar && (info.category === "soda")) score += needs.sugar;
  if (needs.calories) score += Math.min(getProductCalories(pid, products) / 20, needs.calories);
  if (needs.calories_for_recovery) score += Math.min(getProductCalories(pid, products) / 30, needs.calories_for_recovery);
  if (needs.light) {
    const cal = getProductCalories(pid, products);
    if (cal <= 10) score += needs.light;
  }
  return score;
}

const REASONS = {
  post_sport: {
    smartwater: "electrolytes for rehydration",
    dasani: "pure hydration with zero calories",
    latte: "protein and carbs to help muscle recovery",
    sprite: "light refreshment to quench your thirst",
    "cold-brew": "smooth cold caffeine — if you need a gentle lift",
  },
  need_energy: {
    espresso: "fast-acting caffeine kick",
    "cold-brew": "smooth sustained energy, served cold",
    latte: "caffeine plus milk protein for lasting energy",
    coke: "classic caffeine and sugar combo",
    pepsi: "sweet caffeine boost",
  },
  hot_thirsty: {
    smartwater: "electrolyte-infused hydration",
    dasani: "pure, clean, zero-calorie hydration",
    sprite: "crisp lemon-lime refreshment",
    "cold-brew": "cold-brewed and refreshing with a caffeine lift",
    fanta: "fruity and ice-cold carbonated refreshment",
  },
  hungry: {
    latte: "creamy and filling with 180 cal",
    cappuccino: "foamy and satisfying at 150 cal",
    fanta: "fruity and sweet, 160 cal",
  },
};

function getRecommendations(scenarioId, products) {
  const scenario = SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) return { topPicks: [], all: products };
  const scored = products
    .map(p => ({ ...p, score: scoreProduct(p.id, scenario.needs, products) }))
    .sort((a, b) => b.score - a.score);
  const topPicks = scored.filter(p => p.score > 0).slice(0, 3);
  return { topPicks, all: scored };
}

function describeProduct(product) {
  const cal = getProductCalories(product.id, [product]);
  return cal > 0 ? `${product.name} (${cal} cal)` : product.name;
}

function formatRecommendationText(scenarioId, topPicks) {
  if (topPicks.length === 0) return "";
  const reasons = REASONS[scenarioId] || {};
  const formatted = topPicks.map((p, i) => {
    const reason = reasons[p.id] ? ` — ${reasons[p.id]}` : "";
    const rank = i === 0 ? "★ " : "  ";
    return `${rank}${describeProduct(p)} at ${p.price}${reason}`;
  });
  return formatted.join("\n");
}

function findBestMatch(query, products) {
  const lower = query.toLowerCase();
  const byId = products.find(p => p.id === lower || p.id.includes(lower));
  if (byId) return byId;
  const byName = products.find(p => p.name.toLowerCase().includes(lower));
  if (byName) return byName;
  const byDesc = products.find(p => p.description.toLowerCase().includes(lower));
  if (byDesc) return byDesc;
  return products[0];
}

function pickDifferentProduct(products, excludeId) {
  const different = products.find(p => p.id !== excludeId);
  return different || products[0];
}

function detectIntent(message, context) {
  const lower = message.toLowerCase().trim();

  const buyMatch = lower.match(/^(?:buy|purchase|get)\s+(?:me\s+)?(?:a|an|the|some\s+)?(.+)/);
  if (buyMatch) return { type: "direct_buy", query: buyMatch[1] };

  const wantMatch = lower.match(/^(?:i want|i'd like|i would like|give me)\s+(?:a|an|the|some\s+)?(.+)/);
  if (wantMatch) return { type: "direct_buy", query: wantMatch[1] };

  const isAffirmative = /^(?:yes|yeah|yep|sure|ok|okay|let's do it|let's go|do it|proceed)$/i.test(
    lower.replace(/[.!]+$/, "")
  );
  if (isAffirmative && context?.lastAction === "confirm_gate") {
    return { type: "yes" };
  }

  const isNegative = /^(?:no|nope|nah|no thanks|not really|maybe later|no thank you)$/i.test(
    lower.replace(/[.!]+$/, "")
  );
  if (isNegative && context?.lastAction === "confirm_gate") {
    return { type: "no" };
  }

  for (const scenario of SCENARIOS) {
    if (scenario.patterns.some(p => matchesPattern(lower, p))) {
      const needsWords = scenario.patterns.filter(p => matchesPattern(lower, p));
      return { type: "scenario", scenario: scenario.id, matchWord: needsWords[0] || scenario.description };
    }
  }

  const ALL_KEYWORDS = [
    { keyword: "coke", matched: ["coke", "cola", "coca cola", "coca-cola", "cocacola"] },
    { keyword: "pepsi", matched: ["pepsi"] },
    { keyword: "sprite", matched: ["sprite"] },
    { keyword: "fanta", matched: ["fanta", "orange"] },
    { keyword: "dasani", matched: ["dasani", "water"] },
    { keyword: "espresso", matched: ["espresso", "expresso"] },
    { keyword: "latte", matched: ["latte"] },
    { keyword: "cappuccino", matched: ["cappuccino", "capuccino"] },
    { keyword: "cold-brew", matched: ["cold brew", "coldbrew", "iced coffee"] },
    { keyword: "smartwater", matched: ["smartwater", "smart water"] },
  ];

  for (const entry of ALL_KEYWORDS) {
    if (entry.matched.some(k => lower.includes(k))) {
      return { type: "specific", keyword: entry.keyword };
    }
  }

  const VAGUE_PATTERNS = [
    "drink", "options", "product", "what do you have", "available",
    "menu", "list", "show", "beverage", "thirsty", "catalog",
    "what can i get", "what's available", "anything",
  ];
  if (VAGUE_PATTERNS.some(p => lower.includes(p))) {
    return { type: "vague" };
  }

  return { type: "no_match" };
}

async function discoverWithFallback(query, discover = discoverProducts) {
  let result = await discover(query);
  if (result.products.length === 0) {
    result = await discover("all");
  }
  return result.products || [];
}

function calorieSuffix(product) {
  if (product.calories != null) return ` (${product.calories} cal)`;
  return "";
}

function handleScenario(scenarioId, matchWord, products) {
  const { topPicks, all } = getRecommendations(scenarioId, products);
  const intro = SCENARIO_INTROS[scenarioId]?.(matchWord) || "Here are my recommendations based on what you said:";
  const pickLines = formatRecommendationText(scenarioId, topPicks);

  const topPick = topPicks[0] || all[0] || products[0];
  return {
    text: `${intro}\n\n${pickLines}`,
    action: "show_catalog",
    products: all,
    product: topPick,
    recommendations: topPicks.map(p => ({
      productId: p.id,
      reason: REASONS[scenarioId]?.[p.id] || null,
    })),
  };
}

function handleYes(context) {
  const product = context.lastProduct;
  if (!product) {
    return {
      text: "I'm not sure what you're agreeing to. Could you tell me what you'd like?",
      action: "show_catalog",
      products: [],
      product: null,
    };
  }
  return {
    text: `Great choice! Let me set up the payment for ${product.name}. Click below to complete via x402.`,
    action: "show_payment_card",
    product,
  };
}

function handleNo(context, products) {
  const rejectedId = context.lastProduct?.id;
  const recommended = pickDifferentProduct(products, rejectedId);
  if (products.length === 0) {
    return {
      text: "No problem! Unfortunately there are no products available right now.",
      action: "show_catalog",
      products: [],
      product: null,
    };
  }
  return {
    text: `No problem! Here are all the products I have available. I'd recommend ${recommended.name} for ${recommended.price}${calorieSuffix(recommended)}. Would you like to try it?`,
    action: "show_catalog",
    products,
    product: recommended,
  };
}

function handleDirectBuy(query, products) {
  const product = findBestMatch(query, products);
  if (!product) {
    return {
      text: `I couldn't find a product matching "${query}". Here's what's available:`,
      action: "show_catalog",
      products,
      product: products[0] || null,
    };
  }
  return {
    text: `Found ${product.name} for ${product.price}${calorieSuffix(product)}! Setting up your payment now.`,
    action: "show_payment_card",
    product,
  };
}

function handleSpecific(keyword, products) {
  const product = findBestMatch(keyword, products);
  if (!product) {
    return handleNoMatch(keyword, products);
  }
  return {
    text: `I found ${product.name} for ${product.price}${calorieSuffix(product)}. Would you like to buy it?`,
    action: "confirm_gate",
    product,
  };
}

function handleVague(products) {
  if (products.length === 0) {
    return {
      text: "I couldn't find any products available right now.",
      action: "show_catalog",
      products: [],
      product: null,
    };
  }
  const recommended = products[0];
  const count = products.length;
  return {
    text: `I found ${count} product${count > 1 ? "s" : ""} available! Here's what's on offer. I'd recommend starting with ${recommended.name} for ${recommended.price}${calorieSuffix(recommended)}. Would you like to buy it?`,
    action: "show_catalog",
    products,
    product: recommended,
  };
}

function handleNoMatch(userMessage, products) {
  if (products.length === 0) {
    return {
      text: `I couldn't find anything matching "${userMessage}" and there are no products available right now.`,
      action: "show_catalog",
      products: [],
      product: null,
    };
  }
  const recommended = products[0];
  return {
    text: `I didn't find anything matching "${userMessage}", but here are all the products I have available. I'd recommend ${recommended.name} for ${recommended.price}${calorieSuffix(recommended)}. Would you like to buy it?`,
    action: "show_catalog",
    products,
    product: recommended,
  };
}

export async function processMessage(userMessage, context = {}, discover = discoverProducts) {
  const intent = detectIntent(userMessage, context);

  let products = [];
  if (intent.type !== "yes") {
    let query = "all";
    if (intent.type === "direct_buy") query = intent.query;
    else if (intent.type === "specific") query = intent.keyword;
    products = await discoverWithFallback(query, discover);
  }

  switch (intent.type) {
    case "yes":
      return handleYes(context);
    case "no":
      return handleNo(context, products);
    case "direct_buy":
      return handleDirectBuy(intent.query, products);
    case "scenario":
      return handleScenario(intent.scenario, intent.matchWord, products);
    case "specific":
      return handleSpecific(intent.keyword, products);
    case "vague":
      return handleVague(products);
    case "no_match":
      return handleNoMatch(userMessage, products);
    default:
      return {
        text: "I'm not sure how to help with that. Could you tell me what you're looking for?",
        action: "show_catalog",
        products,
        product: products[0] || null,
      };
  }
}

export { detectIntent };
