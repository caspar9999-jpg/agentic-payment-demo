#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { createHash } from "crypto";

const PORT = process.env.PORT || 3001;
const X402_BASE = process.env.X402_BASE || "http://localhost:3002";

function deterministicWallet(seed) {
  const hash = createHash("sha256").update(`merchant_${seed}`).digest("hex");
  return "0x" + hash.slice(0, 40);
}

// ─── Merchant & Product Database ───────────────────────────────────
const MERCHANTS = {
  "coffee-provider": {
    id: "coffee-provider",
    name: "Coffee Provider",
    wallet: process.env.MERCHANT_COFFEE,
    products: {
      espresso: {
        id: "espresso", name: "Espresso", price: "$2.99", priceInCents: 299, calories: 5,
        description: "Rich and bold single-shot espresso made from premium Arabica beans. The perfect quick caffeine boost with a smooth crema finish.",
      },
      latte: {
        id: "latte", name: "Latte", price: "$3.49", priceInCents: 349, calories: 180,
        description: "Smooth espresso topped with steamed milk and a light layer of foam. A classic Italian favorite made with whole milk.",
      },
      cappuccino: {
        id: "cappuccino", name: "Cappuccino", price: "$3.99", priceInCents: 399, calories: 150,
        description: "Equal parts espresso, steamed milk, and thick milk foam. Dusted with cocoa powder for the perfect finish.",
      },
      "cold-brew": {
        id: "cold-brew", name: "Cold Brew", price: "$3.29", priceInCents: 329, calories: 10,
        description: "Slow-steeped for 20 hours to create a smooth, naturally sweet cold coffee concentrate. Served over ice.",
      },
    },
  },
  "soft-drink-provider": {
    id: "soft-drink-provider",
    name: "Soft Drink Provider",
    products: {
      coke: {
        id: "coke", name: "Coca-Cola Classic", price: "$1.99", priceInCents: 199, calories: 140,
        description: "The world's most iconic carbonated soft drink. Originally created in 1886, it features a unique blend of natural flavors. 330ml can.",
      },
      pepsi: {
        id: "pepsi", name: "Pepsi Cola", price: "$1.89", priceInCents: 189, calories: 150,
        description: "A bold, refreshing carbonated soft drink with a citrus-forward flavor profile. Introduced in 1893 by Caleb Bradham. 330ml can.",
      },
      sprite: {
        id: "sprite", name: "Sprite", price: "$1.79", priceInCents: 179, calories: 140,
        description: "Crisp, clean lemon-lime soda beloved for its refreshing taste and caffeine-free formula. 330ml can.",
      },
      fanta: {
        id: "fanta", name: "Fanta Orange", price: "$1.69", priceInCents: 169, calories: 160,
        description: "Vibrant, fruity carbonated soft drink bursting with orange flavor. Caffeine free. 330ml can.",
      },
    },
  },
  "water-provider": {
    id: "water-provider",
    name: "Water Provider",
    products: {
      dasani: {
        id: "dasani", name: "Dasani Water", price: "$0.99", priceInCents: 99, calories: 0,
        description: "Pure, refreshing drinking water enhanced with minerals for a crisp, clean taste. 500ml bottle.",
      },
      smartwater: {
        id: "smartwater", name: "Smartwater", price: "$1.49", priceInCents: 149, calories: 0,
        description: "Vapor-distilled water with added electrolytes for a pure, crisp taste. 600ml bottle.",
      },
    },
  },
};

// Flatten products into a single lookup map for search performance
const PRODUCTS = {};
for (const [merchantId, merchant] of Object.entries(MERCHANTS)) {
  const merchantWallet = merchant.wallet || deterministicWallet(merchantId);
  for (const [productId, product] of Object.entries(merchant.products)) {
    PRODUCTS[productId] = { ...product, merchantId, merchantName: merchant.name, payTo: merchantWallet };
  }
}

// ─── Register products with x402 server on startup ────────────────
let registered = false;

async function registerWithX402() {
  for (const product of Object.values(PRODUCTS)) {
    try {
      const payTo = product.payTo;
      const res = await fetch(`${X402_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          name: product.name,
          priceInCents: product.priceInCents,
          displayPrice: product.price,
          ...(payTo ? { payTo } : {}),
        }),
      });
      const data = await res.json();
      if (data.status === "registered") {
        product.payment_url = data.resourceUrl;
        product.payTo = data.payTo;
        product.network = "eip155:84532";
        console.log(`   Registered "${product.name}" → ${data.resourceUrl} [wallet: ${data.payTo.slice(0, 10)}…]`);
      }
    } catch (e) {
      product.payment_url = `${X402_BASE}/resource/${product.id}`;
      product.payTo = null;
      product.network = "eip155:84532";
      console.log(`   ⚠ x402 not reachable, using fallback URL for "${product.name}"`);
    }
  }
  registered = true;
}

async function waitForX402AndRegister(maxRetries = 10, intervalMs = 3000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${X402_BASE}/`);
      if (res.ok) {
        console.log(`   x402 server is ready, registering products...`);
        await registerWithX402();
        return;
      }
    } catch (e) {
      // x402 not ready yet
    }
    console.log(`   ⏳ Waiting for x402 server (attempt ${i + 1}/${maxRetries})...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  console.log(`   ⚠ x402 server not available after ${maxRetries} retries. Products will use fallback URLs.`);
  // Still set fallback URLs so discovery works (payment will fail gracefully)
  for (const product of Object.values(PRODUCTS)) {
    if (!product.payTo) {
      product.payment_url = `${X402_BASE}/resource/${product.id}`;
      product.network = "eip155:84532";
    }
  }
}

// ─── MCP Server Logic ─────────────────────────────────────────────
function createServer() {
  const server = new Server(
    { name: "mcp-discovery", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "product_discovery",
          description:
            "Discover available products and get their payment links. Returns product details including name, description, payment URL, and price.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Search query for product discovery (e.g. 'cola', 'coke', 'pepsi', or 'all' for all products)",
              },
            },
            required: ["query"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "product_discovery") {
      const query = (args.query || "all").toLowerCase();
      let results;

      if (query === "all") {
        results = Object.values(PRODUCTS);
      } else {
        results = Object.values(PRODUCTS).filter((p) => {
          const searchable = `${p.id} ${p.name} ${p.description}`.toLowerCase();
          return searchable.includes(query);
        });
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "No products found matching your query", query },
                null,
                2
              ),
            },
          ],
        };
      }

      const response = {
        products: results.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          payment_url: p.payment_url,
          price: p.price,
          priceInCents: p.priceInCents,
          calories: p.calories ?? null,
          payment: p.payTo
            ? {
                scheme: "exact",
                price: p.price,
                network: "eip155:84532",
                payTo: p.payTo,
              }
            : null,
        })),
        total: results.length,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2),
        },
      ],
    };
  });

  return server;
}

// ─── HTTP / SSE Server ────────────────────────────────────────────
const app = express();

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Receipt");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Health check
app.get("/", (req, res) => {
  res.json({
    name: "mcp-discovery",
    version: "1.0.0",
    status: "running",
    endpoints: {
      sse: `http://localhost:${PORT}/sse`,
      mcp: `http://localhost:${PORT}/mcp`,
      discover: `http://localhost:${PORT}/discover`,
    },
  });
});

// ─── Helpers ───────────────────────────────────────────────────────
function formatProductResponse(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    merchantId: p.merchantId,
    merchantName: p.merchantName,
    payment_url: p.payment_url,
    price: p.price,
    priceInCents: p.priceInCents,
    calories: p.calories ?? null,
    payment: p.payTo
      ? { scheme: "exact", price: p.price, network: "eip155:84532", payTo: p.payTo }
      : null,
  };
}

function searchProducts(query) {
  const lower = (query || "all").toLowerCase();
  if (lower === "all") return Object.values(PRODUCTS);
  return Object.values(PRODUCTS).filter(p =>
    `${p.id} ${p.name} ${p.description}`.toLowerCase().includes(lower)
  );
}

// Direct REST endpoint for product discovery
app.get("/discover", (req, res) => {
  const results = searchProducts(req.query.query);

  if (results.length === 0) {
    return res.status(404).json({ error: "No products found matching your query", query: req.query.query });
  }

  res.json({
    products: results.map(formatProductResponse),
    total: results.length,
  });
});

// MCP JSON-RPC endpoint (authentic MCP protocol over HTTP)
app.post("/mcp", async (req, res) => {
  const message = req.body;

  if (!message || message.jsonrpc !== "2.0" || !message.method) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: message?.id || null,
      error: { code: -32600, message: "Invalid Request" },
    });
  }

  if (message.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "product_discovery",
            description:
              "Discover available products and get their payment links. Accepts a query string and returns matching products with details, prices, and x402 payment information.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "Search query for product discovery (e.g. 'cola', 'coke', 'pepsi', 'espresso', 'coffee', 'water', or 'all' for all products)",
                },
              },
              required: ["query"],
            },
          },
        ],
      },
    });
  }

  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params || {};

    if (name !== "product_discovery") {
      return res.json({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32602, message: `Unknown tool: ${name}` },
      });
    }

    const query = (args?.query || "all").toLowerCase();
    let results;

    if (query === "all") {
      results = Object.values(PRODUCTS);
    } else {
      results = Object.values(PRODUCTS).filter((p) => {
        const searchable = `${p.id} ${p.name} ${p.description}`.toLowerCase();
        return searchable.includes(query);
      });
    }

    if (results.length === 0) {
      return res.json({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "No products found matching your query", query }, null, 2),
            },
          ],
        },
      });
    }

    const response = {
      products: results.map(formatProductResponse),
      total: results.length,
    };

    return res.json({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      },
    });
  }

  return res.json({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  });
});

// SSE endpoint for MCP clients
const transports = new Map();

app.get("/sse", (req, res) => {
  const server = createServer();
  const transport = new SSEServerTransport("/messages", res);
  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };
  transports.set(transport.sessionId, transport);
  server.connect(transport);
});

app.post("/messages", (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (transport) {
    transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).json({ error: "No active session found" });
  }
});

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 MCP Discovery Server`);
  console.log(`   Port:     ${PORT}`);
  console.log(`   HTTP:     http://localhost:${PORT}`);
  console.log(`   MCP RPC:  http://localhost:${PORT}/mcp`);
  console.log(`   Discover: http://localhost:${PORT}/discover?query=all`);
  console.log(`   x402:     ${X402_BASE}`);
  console.log(`\n   Registering products with x402 server...`);
  await waitForX402AndRegister();
  console.log(`\n   Ready!\n`);
});
