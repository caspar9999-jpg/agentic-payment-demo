#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

const PORT = process.env.PORT || 3001;
const X402_BASE = process.env.X402_BASE || "http://localhost:3002";

// ─── Product Database (owned by MCP Discovery) ────────────────────
const PRODUCTS = {
  coke: {
    id: "coke",
    name: "Coca-Cola Classic",
    description:
      "Coca-Cola Classic is the world's most iconic carbonated soft drink. Originally created in 1886 by Dr. John S. Pemberton, it features a unique blend of natural flavors and a refreshing taste loved by billions. 330ml can, original recipe.",
    price: "$1.99",
    priceInCents: 199,
    calories: 140,
  },
  pepsi: {
    id: "pepsi",
    name: "Pepsi Cola",
    description:
      "Pepsi Cola is a bold, refreshing carbonated soft drink with a citrus-forward flavor profile. First introduced in 1893 by Caleb Bradham, Pepsi delivers a sweeter, slightly more citrusy taste compared to its competitors. 330ml can, classic recipe.",
    price: "$1.89",
    priceInCents: 189,
    calories: 150,
  },
  sprite: {
    id: "sprite",
    name: "Sprite",
    description:
      "Sprite is a crisp, clean lemon-lime soda beloved for its refreshing taste and caffeine-free formula. Introduced in 1961, Sprite has become the world's leading lemon-lime beverage. 330ml can, caffeine free.",
    price: "$1.79",
    priceInCents: 179,
    calories: 140,
  },
  fanta: {
    id: "fanta",
    name: "Fanta Orange",
    description:
      "Fanta Orange is a vibrant, fruity carbonated soft drink bursting with orange flavor. Originally created in 1940, Fanta is known for its bold color and fun, refreshing taste. 330ml can, caffeine free.",
    price: "$1.69",
    priceInCents: 169,
    calories: 160,
  },
  dasani: {
    id: "dasani",
    name: "Dasani Water",
    description:
      "Dasani Water is pure, refreshing drinking water enhanced with minerals for a crisp, clean taste. Produced by Coca-Cola, Dasani undergoes a rigorous purification process. 500ml bottle, zero calories.",
    price: "$0.99",
    priceInCents: 99,
    calories: 0,
  },
};

// ─── Register products with x402 server on startup ────────────────
let registered = false;

async function registerWithX402() {
  for (const product of Object.values(PRODUCTS)) {
    try {
      const res = await fetch(`${X402_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          name: product.name,
          priceInCents: product.priceInCents,
          displayPrice: product.price,
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
      product.payTo = null;
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
      messages: `http://localhost:${PORT}/messages`,
      discover: `http://localhost:${PORT}/discover`,
    },
  });
});

// Direct REST endpoint for product discovery
app.get("/discover", (req, res) => {
  const query = (req.query.query || "all").toLowerCase();
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
    return res.status(404).json({
      error: "No products found matching your query",
      query,
    });
  }

  res.json({
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
  console.log(`   SSE:      http://localhost:${PORT}/sse`);
  console.log(`   Discover: http://localhost:${PORT}/discover?query=all`);
  console.log(`   x402:     ${X402_BASE}`);
  console.log(`\n   Registering products with x402 server...`);
  await waitForX402AndRegister();
  console.log(`\n   Ready!\n`);
});
