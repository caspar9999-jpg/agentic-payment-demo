#!/usr/bin/env node

import express from "express";

const PORT = process.env.PORT || 3001;
const X402_BASE = process.env.X402_BASE || "http://localhost:3002";

let productsCache = [];
let lastFetch = 0;
let lastUpdated = null;
const CACHE_TTL = (() => { const v = parseInt(process.env.CACHE_TTL); return Number.isNaN(v) ? 30000 : v; })();

async function fetchProducts() {
  try {
    const res = await fetch(`${X402_BASE}/products`);
    if (res.ok) {
      const data = await res.json();
      productsCache = data.products || [];
      lastFetch = Date.now();
      lastUpdated = new Date().toISOString();
    }
  } catch {
    // x402 not reachable, use stale cache
  }
}

async function getCachedProducts() {
  if (Date.now() - lastFetch > CACHE_TTL || productsCache.length === 0) {
    await fetchProducts();
  }
  return productsCache;
}

function toBazaarResource(product) {
  return {
    type: "http",
    x402Version: 2,
    resource: `${X402_BASE}/resource/${product.productId}`,
    description: product.merchant ? `${product.name} — ${product.merchant}` : product.name,
    mimeType: "application/json",
    accepts: [{
      scheme: "exact",
      price: product.displayPrice,
      network: product.network || "eip155:84532",
      payTo: product.payTo,
    }],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "GET",
            pathParams: { productId: product.productId },
          },
          output: {
            type: "json",
            example: {
              productId: product.productId,
              name: product.name,
              displayPrice: product.displayPrice,
              payTo: product.payTo,
            },
          },
        },
      },
    },
    lastUpdated: lastUpdated,
  };
}

async function searchProducts(query) {
  const lower = (query || "").toLowerCase();
  const products = await getCachedProducts();
  if (!lower) return products.map(toBazaarResource);
  return products
    .filter((p) =>
      `${p.productId} ${p.name} ${p.merchant || ""}`.toLowerCase().includes(lower)
    )
    .map(toBazaarResource);
}

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => {
  res.json({
    name: "bazaar-discovery",
    version: "1.0.0",
    status: "running",
    endpoints: {
      resources: `http://localhost:${PORT}/discovery/resources`,
      search: `http://localhost:${PORT}/discovery/resources/search?q=`,
    },
    x402Base: X402_BASE,
  });
});

app.get("/discovery/resources", async (req, res) => {
  const sourceProducts = await getCachedProducts();
  const resources = sourceProducts.map(toBazaarResource);
  res.json({ resources, _debug: { sourceProducts } });
});

app.get("/discovery/resources/search", async (req, res) => {
  const query = req.query.q || "";
  const sourceProducts = await getCachedProducts();
  const filtered = sourceProducts.filter((p) =>
    `${p.productId} ${p.name} ${p.merchant || ""}`.toLowerCase().includes(query.toLowerCase())
  );
  const resources = filtered.map(toBazaarResource);
  res.json({ resources, _debug: { sourceProducts, query } });
});

// ─── Start ─────────────────────────────────
const isDirectRun = process.argv[1] && (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("mcpdiscovery\\index.js"));
if (isDirectRun) {
  app.listen(PORT, async () => {
    console.log(`\n🌐 Bazaar Discovery Server`);
    console.log(`   Port:     ${PORT}`);
    console.log(`   Resources: http://localhost:${PORT}/discovery/resources`);
    console.log(`   Search:    http://localhost:${PORT}/discovery/resources/search?q=`);
    console.log(`   x402:     ${X402_BASE}`);
    await fetchProducts();
    console.log(`   Cached ${productsCache.length} products from x402 server`);
    console.log(`\n   Ready!\n`);
  });
}

export default app;
