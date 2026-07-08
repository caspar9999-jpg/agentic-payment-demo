import express from "express";
import cors from "cors";
import crypto from "crypto";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const PORT = process.env.PORT || 3002;
const DEFAULT_NETWORK = "eip155:84532";
const DEFAULT_ASSET = process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_NAME = "USDC";
const USDC_VERSION = "2";
const DEFAULT_TIMEOUT = 300;

function deterministicWallet(seed) {
  const hash = crypto.createHash("sha256").update(`merchant_${seed}`).digest("hex");
  return "0x" + hash.slice(0, 40);
}

const MERCHANT_WALLETS = {
  coffee: process.env.MERCHANT_COFFEE || deterministicWallet("coffee"),
  softdrink: process.env.MERCHANT_SOFTDRINK || deterministicWallet("soft_drink"),
  water: process.env.MERCHANT_WATER || deterministicWallet("water"),
};

const PRODUCT_DEFS = [
  { id: "espresso", name: "Espresso", priceCents: 299, merchant: "coffee", calories: 5 },
  { id: "latte", name: "Latte", priceCents: 349, merchant: "coffee", calories: 180 },
  { id: "cappuccino", name: "Cappuccino", priceCents: 399, merchant: "coffee", calories: 150 },
  { id: "cold-brew", name: "Cold Brew", priceCents: 329, merchant: "coffee", calories: 10 },
  { id: "coke", name: "Coca-Cola Classic", priceCents: 199, merchant: "softdrink", calories: 140 },
  { id: "pepsi", name: "Pepsi Cola", priceCents: 189, merchant: "softdrink", calories: 150 },
  { id: "sprite", name: "Sprite", priceCents: 179, merchant: "softdrink", calories: 140 },
  { id: "fanta", name: "Fanta Orange", priceCents: 169, merchant: "softdrink", calories: 160 },
  { id: "dasani", name: "Dasani Water", priceCents: 99, merchant: "water", calories: 0 },
  { id: "smartwater", name: "Smartwater", priceCents: 149, merchant: "water", calories: 0 },
];

const products = new Map();
for (const def of PRODUCT_DEFS) {
  products.set(def.id, {
    productId: def.id,
    name: def.name,
    priceInCents: def.priceCents,
    displayPrice: `$${(def.priceCents / 100).toFixed(2)}`,
    payTo: MERCHANT_WALLETS[def.merchant],
    network: DEFAULT_NETWORK,
    asset: DEFAULT_ASSET,
    merchant: def.merchant,
    calories: def.calories,
    registeredAt: new Date().toISOString(),
  });
}

const purchases = [];

const app = express();
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:4173"],
  methods: ["GET", "POST", "OPTIONS"],
  exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"],
}));
app.use(express.json());

// ─── Public endpoints (no payment required) ─────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    name: "x402-payment-server", version: "2.0.0", status: "running",
    protocol: "x402", protocolVersion: "V2",
    registeredProducts: products.size,
  });
});

app.get("/products", (req, res) => {
  res.json({ products: Array.from(products.values()), total: products.size });
});

app.get("/merchants", (req, res) => {
  const merchantMap = new Map();
  for (const p of products.values()) {
    const mid = p.merchant;
    if (!merchantMap.has(mid)) {
      merchantMap.set(mid, { wallet: p.payTo, merchantId: mid, products: [], totalProducts: 0, balance: 0, balanceUSD: "$0.00", network: p.network });
    }
    const entry = merchantMap.get(mid);
    entry.products.push({ productId: p.productId, name: p.name, displayPrice: p.displayPrice, priceInCents: p.priceInCents });
    entry.totalProducts++;
  }
  const revenueByWallet = {};
  for (const p of purchases) {
    revenueByWallet[p.payTo] = (revenueByWallet[p.payTo] || 0) + p.priceInCents;
  }
  const merchants = Array.from(merchantMap.values()).map(m => {
    const balance = revenueByWallet[m.wallet] || 0;
    return { ...m, balance, balanceUSD: `$${(balance / 100).toFixed(2)}` };
  });
  res.json({ merchants });
});

app.get("/merchant/:wallet", (req, res) => {
  const wallet = req.params.wallet;
  const merchantPurchases = purchases.filter(p => p.payTo === wallet);
  const merchantProducts = Array.from(products.values()).filter(p => p.payTo === wallet);
  if (merchantProducts.length === 0) return res.status(404).json({ error: "Merchant not found" });
  const salesByProduct = {};
  for (const p of merchantPurchases) {
    if (!salesByProduct[p.productId]) salesByProduct[p.productId] = { count: 0, revenueCents: 0 };
    salesByProduct[p.productId].count++;
    salesByProduct[p.productId].revenueCents += p.priceInCents;
  }
  const productList = merchantProducts.map(p => {
    const s = salesByProduct[p.productId] || { count: 0, revenueCents: 0 };
    const revenue = s.revenueCents;
    return { productId: p.productId, name: p.name, displayPrice: p.displayPrice, priceInCents: p.priceInCents, sales: s.count, revenueCents: revenue, revenueUSD: `$${(revenue / 100).toFixed(2)}` };
  });
  const totalRevenue = merchantPurchases.reduce((s, p) => s + p.priceInCents, 0);
  const totalSales = merchantPurchases.length;
  res.json({
    wallet,
    merchantId: merchantProducts[0].merchant,
    network: DEFAULT_NETWORK,
    products: productList,
    totalProducts: merchantProducts.length,
    totalSales,
    totalRevenueCents: totalRevenue,
    totalRevenueUSD: `$${(totalRevenue / 100).toFixed(2)}`,
    recentPurchases: merchantPurchases.slice(-10).reverse().map(p => ({
      purchaseId: p.purchaseId, productName: p.productName, priceInCents: p.priceInCents, timestamp: p.timestamp,
    })),
  });
});

// ─── Debug endpoints ────────────────────────────────────────────────────────

app.get("/debug/requirements/:productId", (req, res) => {
  const route = routes[`/resource/${req.params.productId}`];
  if (!route) return res.status(404).json({ error: "Product not found" });
  res.json({
    productId: req.params.productId,
    route,
    facilitatorUrl: process.env.FACILITATOR_URL || "https://x402.org/facilitator",
    defaultNetwork: DEFAULT_NETWORK,
    defaultAsset: DEFAULT_ASSET,
  });
});

app.get("/debug/purchases", (req, res) => {
  res.json({ purchases: purchases.slice(-20), total: purchases.length });
});

// ─── x402 middleware — protects /resource/:productId routes ────────────────

const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL || "https://x402.org/facilitator",
});

const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server, { networks: [DEFAULT_NETWORK] });

const routes = {};
for (const [id, product] of products) {
  routes[`/resource/${id}`] = {
    accepts: {
      scheme: "exact",
      payTo: product.payTo,
      price: product.displayPrice,
      network: DEFAULT_NETWORK,
      maxTimeoutSeconds: DEFAULT_TIMEOUT,
      extra: { name: USDC_NAME, version: USDC_VERSION, assetTransferMethod: "eip3009" },
    },
    description: `Payment required for ${product.name}`,
    mimeType: "application/json",
  };
}

const paymentMw = paymentMiddleware(routes, server);

// Decode 402 header into body for developer readability
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 402 && body && typeof body === "object" && Object.keys(body).length === 0) {
      const prHeader = res.getHeader("payment-required");
      if (prHeader) {
        try {
          body = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
      console.log("[x402 debug] 402 PAYMENT-REQUIRED sent to client:");
      console.log("  full body:", JSON.stringify(body, null, 2));
        } catch (_) {}
      }
    }
    return originalJson(body);
  };
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith("/resource/")) {
    const allHeaders = Object.entries(req.headers).map(([k, v]) => `  ${k}: ${typeof v === "string" ? v.slice(0, 200) : v}`).join("\n");
    console.log(`[x402 debug] Request: ${req.method} ${req.path}\n${allHeaders || "  (no headers)"}`);
    const paySig = req.headers["payment-signature"];
    if (paySig) {
      try {
        const payload = JSON.parse(Buffer.from(paySig, "base64").toString("utf8"));
        console.log("[x402 debug] Decoded PAYMENT-SIGNATURE:");
        console.log("  accepted:", JSON.stringify(payload.accepted, null, 4));
        console.log("  payload.authorization:", JSON.stringify(payload.payload?.authorization, null, 4));
        console.log("  payload.signature:", payload.payload?.signature);
      } catch (e) {
        console.log("[x402 debug] PAYMENT-SIGNATURE parse failed:", e.message, "| raw:", paySig.slice(0, 100));
      }
    }
  }
  next();
});

app.use(paymentMw);

app.use((err, req, res, _next) => {
  console.error("[x402 debug] Payment error:");
  console.error("  message:", err?.message);
  console.error("  statusCode:", err?.statusCode);
  console.error("  response data:", JSON.stringify(err?.response?.data || err?.response));
  console.error("  stack:", err?.stack?.split("\n").slice(0, 3).join("\n"));
  res.status(502).json({ error: "Facilitator error", message: err?.message || "Unknown payment error" });
});

// ─── Protected resource handler (runs only after payment verified) ─────────

app.get("/resource/:productId", async (req, res) => {
  const product = products.get(req.params.productId);
  if (!product) return res.status(404).json({ error: "Resource not found", productId: req.params.productId });

  const purchaseId = generatePurchaseId(product.productId);
  const nft = generateNft(product, purchaseId);

  let txHash = null;
  try {
    const prHeader = res.getHeader("payment-response");
    if (prHeader) {
      const responseObj = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
      txHash = responseObj.transaction || null;
    }
  } catch (_) {}

  purchases.push({
    purchaseId, productId: product.productId, productName: product.name,
    priceInCents: product.priceInCents, payTo: product.payTo,
    network: DEFAULT_NETWORK, txHash, nft,
    timestamp: new Date().toISOString(),
  });

  res.json({
    status: "paid",
    message: `Resource access granted for ${product.name}`,
    productId: product.productId,
    name: product.name,
    displayPrice: product.displayPrice,
    resource: nft,
    purchaseId,
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function generatePurchaseId(productId) {
  return `x402_${productId}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function generateNft(product, purchaseId) {
  const name = product.name;
  const price = product.displayPrice;
  const colors = ["#1a1a2e", "#16213e", "#0f3460", "#1b1b2f", "#2d2d44"];
  const bgColor = colors[Math.abs(hashCode(product.productId)) % colors.length];
  const accentColor = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa"][Math.abs(hashCode(product.productId)) % 5];
  return `<svg width="400" height="560" xmlns="http://www.w3.org/2000/svg">
  <rect width="400" height="560" fill="${bgColor}" rx="16"/>
  <rect x="20" y="20" width="360" height="520" fill="none" stroke="${accentColor}" stroke-width="1" rx="12" opacity="0.3"/>
  <text x="200" y="80" text-anchor="middle" fill="${accentColor}" font-size="14" font-family="monospace" letter-spacing="3">X402 COLLECTIBLE</text>
  <text x="200" y="130" text-anchor="middle" fill="#fff" font-size="28" font-family="monospace" font-weight="bold">${escapeXml(name)}</text>
  <circle cx="200" cy="240" r="60" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.4"/>
  <text x="200" y="248" text-anchor="middle" fill="${accentColor}" font-size="36" font-family="monospace" font-weight="bold">${escapeXml(price)}</text>
  <text x="200" y="290" text-anchor="middle" fill="#666" font-size="12" font-family="monospace">PAID VIA X402 PROTOCOL</text>
  <text x="200" y="320" text-anchor="middle" fill="#555" font-size="11" font-family="monospace">${DEFAULT_NETWORK}</text>
  <line x1="80" y1="360" x2="320" y2="360" stroke="#333" stroke-width="1"/>
  <text x="200" y="420" text-anchor="middle" fill="#555" font-size="10" font-family="monospace">ID ${escapeXml(purchaseId)}</text>
  <text x="200" y="450" text-anchor="middle" fill="#555" font-size="10" font-family="monospace">${new Date().toISOString().split("T")[0]}</text>
  <text x="200" y="500" text-anchor="middle" fill="#444" font-size="9" font-family="monospace" letter-spacing="2">AGENTIC PAYMENT DEMO</text>
</svg>`;
}

function escapeXml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return h; }

export default app;
