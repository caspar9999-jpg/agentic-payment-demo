#!/usr/bin/env node

import express from "express";
import cors from "cors";
import crypto from "crypto";

const PORT = process.env.PORT || 3002;
const DEFAULT_NETWORK = "eip155:84532";
const DEFAULT_BALANCE_CENTS = 1000;

function merchantWalletForProduct(productId) {
  const hash = crypto.createHash("sha256").update(`merchant_${productId}`).digest("hex");
  return "0x" + hash.slice(0, 40);
}

const products = new Map();
const userWallets = new Map();
const merchantWallets = new Map();
const purchases = [];
const paymentsSeen = new Set();

function getUserWallet(sessionId) {
  if (!userWallets.has(sessionId)) {
    userWallets.set(sessionId, DEFAULT_BALANCE_CENTS);
  }
  return userWallets.get(sessionId);
}

function getMerchantWallet(walletAddress) {
  if (!merchantWallets.has(walletAddress)) {
    merchantWallets.set(walletAddress, 0);
  }
  return merchantWallets.get(walletAddress);
}

function createPaymentRequired(product) {
  return {
    accepts: [
      {
        scheme: "exact",
        price: product.displayPrice,
        network: DEFAULT_NETWORK,
        payTo: product.payTo,
      },
    ],
    description: `Payment for ${product.name}`,
    mimeType: "application/json",
  };
}

function createSettlementResponse(status, details) {
  return {
    status,
    txHash: details.txHash || null,
    amount: String(details.amount || 0),
    network: details.network || DEFAULT_NETWORK,
    timestamp: new Date().toISOString(),
    balance: details.balance ?? null,
    ...(details.error ? { error: details.error } : {}),
  };
}

function generateTxHash() {
  return "0x" + Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

function generatePurchaseId(productId) {
  const nonce = Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
  return `x402_${productId}_${nonce}`;
}

function base64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

const app = express();
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:4173"],
  methods: ["GET", "POST", "OPTIONS"],
  exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"],
}));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "x402-payment-server",
    version: "2.0.0",
    status: "running",
    protocol: "x402",
    protocolVersion: "V2",
    registeredProducts: products.size,
  });
});

app.post("/register", (req, res) => {
  const { productId, name, priceInCents, displayPrice } = req.body;
  if (!productId || !priceInCents) {
    return res.status(400).json({ error: "Missing required fields: productId, priceInCents" });
  }
  const payTo = merchantWalletForProduct(productId);
  products.set(productId, {
    productId,
    name: name || productId,
    priceInCents,
    displayPrice: displayPrice || `$${(priceInCents / 100).toFixed(2)}`,
    payTo,
    network: DEFAULT_NETWORK,
    registeredAt: new Date().toISOString(),
  });
  res.json({
    status: "registered",
    productId,
    name: name || productId,
    priceInCents,
    payTo,
    resourceUrl: `http://localhost:${PORT}/resource/${productId}`,
  });
});

app.get("/products", (req, res) => {
  res.json({ products: Array.from(products.values()), total: products.size });
});

app.get("/resource/:productId", (req, res) => {
  const { productId } = req.params;
  const product = products.get(productId);
  if (!product) {
    return res.status(404).json({ error: "Resource not found", productId });
  }

  const paymentSignatureHeader = req.headers["payment-signature"];

  if (!paymentSignatureHeader) {
    const paymentRequired = createPaymentRequired(product);
    res.set("PAYMENT-REQUIRED", base64(paymentRequired));
    return res.status(402).json({
      status: "payment_required",
      message: `Payment required for ${product.name}`,
      paymentRequired,
    });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(paymentSignatureHeader, "base64").toString("utf-8"));
  } catch {
    const sr = createSettlementResponse("settle_failed", {
      error: "Invalid PAYMENT-SIGNATURE format",
      amount: product.priceInCents,
      network: DEFAULT_NETWORK,
    });
    res.set("PAYMENT-RESPONSE", base64(sr));
    return res.status(402).json({ status: "payment_failed", settlementResponse: sr });
  }

  const { sessionId, paymentId } = payload;

  if (paymentsSeen.has(paymentId)) {
    const existing = purchases.find(p => p.paymentId === paymentId);
    if (existing) {
      res.set("PAYMENT-RESPONSE", base64(existing.settlementResponse));
      return res.json({
        status: "paid",
        message: "Payment already processed",
        resource: existing.nft,
        purchaseId: existing.purchaseId,
        settlementResponse: existing.settlementResponse,
      });
    }
  }

  const balance = getUserWallet(sessionId);
  if (balance < product.priceInCents) {
    const sr = createSettlementResponse("settle_failed", {
      error: "Insufficient balance",
      amount: product.priceInCents,
      network: DEFAULT_NETWORK,
      balance,
      shortBy: product.priceInCents - balance,
      ...(balance !== undefined ? { balance } : {}),
    });
    res.set("PAYMENT-RESPONSE", base64(sr));
    return res.status(402).json({ status: "payment_failed", settlementResponse: sr });
  }

  userWallets.set(sessionId, balance - product.priceInCents);
  const merchantBal = getMerchantWallet(product.payTo);
  merchantWallets.set(product.payTo, merchantBal + product.priceInCents);

  const txHash = generateTxHash();
  const purchaseId = generatePurchaseId(productId);

  const sr = createSettlementResponse("settled", {
    txHash,
    amount: product.priceInCents,
    network: DEFAULT_NETWORK,
    balance: userWallets.get(sessionId),
  });

  const nft = generateNft(product, txHash, purchaseId);

  const purchaseRecord = {
    purchaseId,
    productId: product.productId,
    productName: product.name,
    priceInCents: product.priceInCents,
    displayPrice: product.displayPrice,
    txHash,
    network: DEFAULT_NETWORK,
    settlementResponse: sr,
    nft,
    paymentId,
    sessionId,
    timestamp: sr.timestamp,
  };
  purchases.push(purchaseRecord);
  paymentsSeen.add(paymentId);

  res.set("PAYMENT-RESPONSE", base64(sr));
  return res.json({
    status: "paid",
    message: `Resource access granted for ${product.name}`,
    resource: nft,
    purchaseId,
    settlementResponse: sr,
  });
});

function generateNft(product, txHash, purchaseId) {
  const name = product.name;
  const price = product.displayPrice;
  const shortTx = txHash.slice(0, 10) + "..." + txHash.slice(-6);
  const colors = ["#1a1a2e", "#16213e", "#0f3460", "#1b1b2f", "#2d2d44"];
  const bgColor = colors[Math.abs(hashCode(product.productId)) % colors.length];
  const accentColor = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa"][
    Math.abs(hashCode(product.productId)) % 5
  ];

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
  <text x="200" y="390" text-anchor="middle" fill="#666" font-size="10" font-family="monospace">TX ${escapeXml(shortTx)}</text>
  <text x="200" y="420" text-anchor="middle" fill="#555" font-size="10" font-family="monospace">ID ${escapeXml(purchaseId)}</text>
  <text x="200" y="450" text-anchor="middle" fill="#555" font-size="10" font-family="monospace">${new Date().toISOString().split("T")[0]}</text>
  <text x="200" y="500" text-anchor="middle" fill="#444" font-size="9" font-family="monospace" letter-spacing="2">AGENTIC PAYMENT DEMO</text>
</svg>`;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

app.get("/wallet/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const balance = getUserWallet(sessionId);
  res.json({
    sessionId,
    balance,
    balanceUSD: `$${(balance / 100).toFixed(2)}`,
    currency: "USDC",
    network: DEFAULT_NETWORK,
  });
});

app.post("/wallet/:sessionId/reset", (req, res) => {
  const { sessionId } = req.params;
  userWallets.set(sessionId, DEFAULT_BALANCE_CENTS);
  res.json({
    sessionId,
    balance: DEFAULT_BALANCE_CENTS,
    balanceUSD: `$${(DEFAULT_BALANCE_CENTS / 100).toFixed(2)}`,
    message: "Wallet reset to default balance",
  });
});

app.get("/purchases/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const userPurchases = purchases.filter(p => p.sessionId === sessionId);
  res.json({
    sessionId,
    purchases: userPurchases,
    total: userPurchases.length,
  });
});

app.get("/merchant/:walletAddress", (req, res) => {
  const { walletAddress } = req.params;
  const balance = getMerchantWallet(walletAddress);
  const productOwned = Array.from(products.values()).filter(p => p.payTo === walletAddress);
  res.json({
    wallet: walletAddress,
    balance,
    balanceUSD: `$${(balance / 100).toFixed(2)}`,
    currency: "USDC",
    network: DEFAULT_NETWORK,
    products: productOwned.map(p => ({ id: p.productId, name: p.name, displayPrice: p.displayPrice })),
  });
});

app.get("/merchants", (req, res) => {
  const wallets = Array.from(merchantWallets.keys());
  const all = wallets.map(w => ({
    wallet: w,
    balance: merchantWallets.get(w),
    balanceUSD: `$${(merchantWallets.get(w) / 100).toFixed(2)}`,
  }));
  const productMerchants = Array.from(products.values()).map(p => ({
    wallet: p.payTo,
    productId: p.productId,
    productName: p.name,
    balance: merchantWallets.get(p.payTo) || 0,
    balanceUSD: `$${((merchantWallets.get(p.payTo) || 0) / 100).toFixed(2)}`,
  }));
  res.json({ merchants: productMerchants });
});

app.listen(PORT, () => {
  console.log(`\n💰 x402 Payment Server (V2)`);
  console.log(`   Port:       ${PORT}`);
  console.log(`   Protocol:   x402 V2`);
  console.log(`   Network:    ${DEFAULT_NETWORK}`);
  console.log(`   Headers:    PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE\n`);
});
