const X402_BASE = "/x402";
const MCP_BASE = "/mcp";

function base64Encode(obj) {
  const json = JSON.stringify(obj);
  if (typeof btoa === "function") return btoa(json);
  return Buffer.from(json, "utf-8").toString("base64");
}

function base64Decode(str) {
  let json;
  if (typeof atob === "function") json = atob(str);
  else json = Buffer.from(str, "base64").toString("utf-8");
  return JSON.parse(json);
}

async function fetchJson(url, options) {
  const res = options ? await fetch(url, options) : await fetch(url);
  const data = await res.json();
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

function createPaymentPayload(productId, sessionId, acceptOption) {
  return {
    scheme: acceptOption.scheme,
    price: acceptOption.price,
    network: acceptOption.network,
    payTo: acceptOption.payTo,
    paymentId: `pay_${productId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
  };
}

function errorMessage(status, data, settlementResponse) {
  if (settlementResponse?.error) return settlementResponse.error;
  if (data?.error) return data.error;
  if (data?.settlementResponse?.error) return data.settlementResponse.error;
  if (status === 404) return "Product not registered with x402 server (try re-registering)";
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

  async payForResource(productId, sessionId) {
    const access = await this.accessResource(productId);
    if (access.status !== "payment_required") {
      return access;
    }

    const acceptOption = access.paymentRequired.accepts[0];
    const payload = createPaymentPayload(productId, sessionId, acceptOption);

    let res;
    try {
      res = await fetch(`${X402_BASE}/resource/${productId}`, {
        headers: { "PAYMENT-SIGNATURE": base64Encode(payload) },
      });
    } catch (e) {
      return { status: "error", error: `Cannot reach x402 server: ${e.message}` };
    }

    const data = await res.json();
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

  async getBalance(sessionId) {
    const { data } = await fetchJson(`${X402_BASE}/wallet/${sessionId}`);
    return data;
  },

  async resetWallet(sessionId) {
    const { data } = await fetchJson(`${X402_BASE}/wallet/${sessionId}/reset`, {
      method: "POST",
    });
    return data;
  },

  async getPurchases(sessionId) {
    const { data } = await fetchJson(`${X402_BASE}/purchases/${sessionId}`);
    return data;
  },

  async getMerchantBalances() {
    const { data } = await fetchJson(`${X402_BASE}/merchants`);
    return data.merchants || [];
  },
};

export async function discoverProducts(query = "all") {
  try {
    const res = await fetch(`${MCP_BASE}/discover?query=${encodeURIComponent(query)}`);
    if (!res.ok) return { products: [], total: 0 };
    const data = await res.json();
    return {
      products: data.products || [],
      total: data.total || 0,
    };
  } catch (e) {
    console.error("MCP discovery failed:", e.message);
    return { products: [], total: 0 };
  }
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

  const ALL_KEYWORDS = [
    { keyword: "coke", matched: ["coke", "cola", "coca cola", "coca-cola", "cocacola"] },
    { keyword: "pepsi", matched: ["pepsi"] },
    { keyword: "sprite", matched: ["sprite"] },
    { keyword: "fanta", matched: ["fanta", "orange"] },
    { keyword: "dasani", matched: ["dasani", "water", "dasanii"] },
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
