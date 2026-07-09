# x402 Architecture — Reference Document

## Table of Contents

1. [What is x402?](#1-what-is-x402)
2. [Core Components](#2-core-components)
3. [Merchant Setup — Deep Dive](#3-merchant-setup--deep-dive)
4. [Wallet Registration & Identity](#4-wallet-registration--identity)
5. [The Bazaar Discovery Layer](#5-the-bazaar-discovery-layer)
6. [Agent Payment Flow — Step by Step](#6-agent-payment-flow--step-by-step)
7. [Wire Format — Headers & Payloads](#7-wire-format--headers--payloads)
8. [Trust Model & Guarantees](#8-trust-model--guarantees)
9. [Real-World Adoption](#9-real-world-adoption)
10. [Comparison to Alternatives](#10-comparison-to-alternatives)
11. [Glossary](#11-glossary)

---

## 1. What is x402?

x402 is an implementation of **HTTP 402 Payment Required** — a status code defined in the original HTTP/1.1 spec (RFC 2068, 1997) but never widely adopted. It turns any HTTP endpoint into a pay-per-use API using cryptocurrency settlement.

**The core idea:** A client requests a resource, the server responds with `402 Payment Required` and a payment challenge, the client signs a cryptographic authorization, the server verifies and settles on-chain, then serves the content.

**Key properties:**
- No API keys or user accounts — the wallet IS the identity
- Instant settlement via USDC on Base/Solana
- No chargebacks — once settled, the transfer is final
- No payment processor middleman — the facilitator only verifies signatures
- Pay-per-request, no subscriptions

---

## 2. Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent (Client)                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Bazaar   │  │ x402 Client  │  │ Wallet (MetaMask     │  │
│  │ Discovery│──│ SDK          │──│ or any EIP-1193)     │  │
│  └──────────┘  └──────────────┘  └──────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP 402 handshake
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Merchant Server                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  @x402/express middleware                             │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ Route       │  │ Payment      │  │ Content    │  │  │
│  │  │ Definitions │──│ Verification │──│ Delivery   │  │  │
│  │  └─────────────┘  └──────┬───────┘  └────────────┘  │  │
│  └──────────────────────────┼───────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────┘
                              │ delegate verify + settle
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Facilitator (x402.org)                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ Signature      │  │ USDC Transfer  │  │ Merchant       │  │
│  │ Verification   │  │ Settlement     │  │ Wallet Registry│  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Agent (Client)

The consuming side — an AI agent, browser, or script that wants to access a paywalled resource. Responsibilities:

- **Discover** services via Bazaar or direct URL
- **Sign** payment payloads using a wallet (EIP-712 typed data)
- **Submit** `PAYMENT-SIGNATURE` header to the merchant
- **Receive** content after the facilitator settles

The x402 client SDK (`@x402/core/client`) handles payload creation and header encoding. In the browser, it delegates signing to `window.ethereum` (MetaMask). In server-side agents, it uses a private key directly.

### 2.2 Merchant Server

The selling side — any HTTP server that wants to charge for resources. Responsibilities:

- **Define routes** with payment requirements (price, asset, network, wallet)
- **Return 402** with `PAYMENT-REQUIRED` header for unpaid requests
- **Forward** `PAYMENT-SIGNATURE` to the facilitator for verification
- **Serve** content only after successful verification

Integration is minimal: wrap existing endpoints with `@x402/express` middleware. No database, no user management, no API key issuance.

### 2.3 Facilitator

The protocol's trust anchor — a remote service (e.g., `https://x402.org/facilitator`) that:

- **Verifies** EIP-712 signature validity and payload integrity
- **Checks** that the signer has sufficient USDC balance
- **Settles** the USDC transfer on-chain (agent → merchant)
- **Returns** the settlement result (success + tx hash, or failure reason)

The merchant never touches the settlement flow. The facilitator abstracts all on-chain complexity.

### 2.4 Bazaar (Discovery Layer)

An optional directory index that aggregates x402 endpoints for agent discovery. Agentic Market (`agentic.market`) is the primary production Bazaar. Functions:

- **Index** registered merchant endpoints with metadata (name, description, price, network)
- **Search** by keyword, category, or price range
- **Transform** raw merchant endpoints into standardized Bazaar resources

---

## 3. Merchant Setup — Deep Dive

### 3.1 Prerequisites

- An HTTP server (Express, Fastify, or any Node.js framework)
- A wallet address (EVM, for USDC settlement on Base)
- Registered wallet with the facilitator (see [Section 4](#4-wallet-registration--identity))
- `@x402/express` and `@x402/evm/exact/server` npm packages

### 3.2 Implementation

```js
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const app = express();

// 1. Create facilitator client
const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

// 2. Create resource server
const server = new x402ResourceServer(facilitator);
registerExactEvmScheme(server, {
  networks: ["eip155:84532"], // Base Sepolia
});

// 3. Define route with payment requirements
const route = {
  accepts: {
    scheme: "exact",
    payTo: "0xYourMerchantWallet...",
    price: "$1.99",
    network: "eip155:84532",
    maxTimeoutSeconds: 300,
    extra: {
      name: "USDC",
      version: "2",
      assetTransferMethod: "eip3009",
    },
  },
  description: "Premium article access",
  mimeType: "text/html",
};

// 4. Protect the endpoint
app.get("/article/:id", paymentMiddleware(route, server), (req, res) => {
  // Only reached after successful payment
  res.send("<html>Premium content here</html>");
});
```

**What the middleware does automatically:**
- On first request (no `PAYMENT-SIGNATURE`): returns `402` with base64-encoded `PAYMENT-REQUIRED` header containing the `accepts[]` options
- On second request (with `PAYMENT-SIGNATURE`): decodes the header, calls `facilitator.verifyPayment()`, then `facilitator.settlePayment()`, and on success passes control to the handler
- On failure: returns appropriate error codes (402 retry, 502 facilitator error)

### 3.3 Product Registration Data

Each route must define:

| Field | Type | Description |
|---|---|---|
| `scheme` | string | Payment scheme identifier (e.g. `"exact"` for exact USDC amount) |
| `price` | string | Human-readable price (e.g. `"$1.99"`) |
| `payTo` | address | Merchant's wallet address (0x-prefixed hex) |
| `network` | CAIP-2 | Blockchain identifier (e.g. `"eip155:84532"`) |
| `maxTimeoutSeconds` | number | How long the payment challenge is valid |
| `extra` | object | Scheme-specific metadata (token name, version, transfer method) |

### 3.4 Dynamic Routes for Discovery

Merchants with many products should expose a `GET /products` endpoint and use dynamic route patterns so the Bazaar can auto-discover them without manual registration for each SKU:

```js
// Server returns a product catalog
app.get("/products", (req, res) => {
  res.json({
    products: [
      { productId: "article-123", name: "Deep Dive", price: "$1.99", payTo: "0x..." },
      { productId: "article-456", name: "Analysis", price: "$2.99", payTo: "0x..." },
    ],
  });
});

// Single dynamic route handler
app.get("/resource/:productId", paymentMiddleware(dynamicRoutes, server), handler);
```

The Bazaar indexes `GET /products` and creates a resource entry for each product, automatically linking to the `GET /resource/:productId` pattern.

---

## 4. Wallet Registration & Identity

### 4.1 How Wallet Identity Works

In x402, there are no user accounts. The wallet address IS the identity:

- **Agent identity:** The address that signs the payment payload
- **Merchant identity:** The `payTo` address in the route definition

### 4.2 Facilitator Registration

The merchant must register their wallet with the facilitator before receiving payments:

1. Merchant generates a message: `"I control wallet 0x... for x402 payments on eip155:84532"`
2. Merchant signs it with their wallet's private key
3. Merchant sends the signature to the facilitator
4. Facilitator stores the mapping: `wallet → verified`

On settlement, the facilitator checks that the `payTo` address in the payment requirements matches a registered wallet. If not, settlement is rejected.

### 4.3 No Registration for Agents

Agents do NOT need to register. Any wallet with USDC balance can pay any x402 endpoint. The facilitator checks balance at settlement time, not beforehand.

### 4.4 Security Model

- **Who can spend:** Only the holder of the private key that signs the EIP-712 payload
- **Who can receive:** Only wallets registered with the facilitator
- **Replay protection:** Each payment payload includes a unique `paymentId` and the facilitator checks for duplicates
- **Expiration:** `maxTimeoutSeconds` limits how long a payment challenge is valid

---

## 5. The Bazaar Discovery Layer

### 5.1 Architecture

```
Agent                    Bazaar                        Merchant
  │                        │                              │
  │  GET /discovery/       │                              │
  │  resources             │                              │
  │───────────────────────▶│                              │
  │                        │  GET /products               │
  │                        │──────────────────────────────▶│
  │                        │◄─────────────────────────────│
  │                        │  { products[] }              │
  │                        │                              │
  │◄───────────────────────│                              │
  │  { resources[] }       │                              │
  │                        │                              │
  │  GET /resource/coke    │                              │
  │──────────────────────────────────────────────────────▶│
  │◄──────────────────────────────────────────────────────│
  │  402 + PAYMENT-REQUIRED                               │
```

### 5.2 Data Flow

1. Bazaar fetches `GET /products` from the merchant server (cached, TTL-configurable)
2. Bazaar transforms each product into a standardized resource format:
   ```json
   {
     "type": "http",
     "x402Version": 2,
     "resource": "https://merchant.com/resource/coke",
     "description": "Coca-Cola Classic",
     "accepts": [{
       "scheme": "exact",
       "price": "$1.99",
       "network": "eip155:84532",
       "payTo": "0xmerchant_wallet"
     }],
     "extensions": {
       "bazaar": {
         "info": {
           "input": { "type": "http", "method": "GET", "pathParams": { "productId": "coke" } },
           "output": { "type": "json" }
         }
       }
     }
   }
   ```
3. Agent queries Bazaar → receives resources → selects one → calls the resource URL directly
4. Merchant handles the x402 handshake independently — Bazaar is out of the loop

### 5.3 Bazaar Search

Bazaar supports keyword search (`GET /discovery/resources/search?q=coffee`) which filters by product ID, name, and merchant name. In production (Agentic Market), search also supports category filters, price range, and network filtering.

### 5.4 Caching

The Bazaar caches the merchant's product catalog with a configurable TTL (default 30 seconds). This reduces load on the merchant server and provides fast responses to agents. Stale cache is used if the merchant is unreachable.

---

## 6. Agent Payment Flow — Step by Step

### 6.1 Complete Sequence

```
  Agent                    Merchant                   Facilitator             On-Chain
   │                          │                          │                      │
   │── GET /resource/coke ───▶│                          │                      │
   │                          │                          │                      │
   │◄─ 402 PAYMENT-REQUIRED ──│                          │                      │
   │   { accepts: [{          │                          │                      │
   │     price: "$1.99",      │                          │                      │
   │     payTo: "0x...",      │                          │                      │
   │     network: "eip155:.." │                          │                      │
   │   }]}                    │                          │                      │
   │                          │                          │                      │
   │  (User sees MetaMask      │                          │                      │
   │   prompt to sign         │                          │                      │
   │   EIP-712 typed data)    │                          │                      │
   │                          │                          │                      │
   │── PAYMENT-SIGNATURE ────▶│                          │                      │
   │   { x402Version: 2,     │                          │                      │
   │     paymentId: "pay_xx",│                          │                      │
   │     accepted: {...},     │                          │                      │
   │     payload: {           │                          │                      │
   │       authorization:..., │                          │                      │
   │       signature:...      │                          │                      │
   │     }                    │                          │                      │
   │   }                      │                          │                      │
   │                          │                          │                      │
   │                          │── verifyPayment() ──────▶│                      │
   │                          │◄─ { verified: true } ────│                      │
   │                          │                          │                      │
   │                          │── settlePayment() ──────▶│── USDC transfer ────▶│
   │                          │                          │◄─ tx hash ──────────│
   │                          │◄─ { success: true,       │                      │
   │                          │     transaction: "0x..." }│                     │
   │                          │                          │                      │
   │◄─ 200 + content ────────│                          │                      │
   │   { resource: "<svg>..",│                          │                      │
   │     PAYMENT-RESPONSE:   │                          │                      │
   │     { success, tx }     │                          │                      │
   │   }                     │                          │                      │
```

### 6.2 Detailed Steps

#### Step 1: Resource Access

Agent sends `GET /resource/:productId` to the merchant server with no payment headers.

#### Step 2: 402 Payment Required

Merchant server responds with:
- **Status:** 402
- **Header:** `PAYMENT-REQUIRED` (base64-encoded JSON)
- **Body:** decoded copy of the header (for developer readability)

The `PAYMENT-REQUIRED` JSON:
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://merchant.com/resource/coke",
    "description": "Payment required for Coca-Cola Classic",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "1990000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x4c1171ef4784563d6142d285e5e2c5a3288051d1",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USDC",
        "version": "2",
        "assetTransferMethod": "eip3009"
      }
    }
  ]
}
```

Note: `amount` is in micro-units (1990000 = $1.99 in 6-decimal USDC), not the display price string.

#### Step 3: Wallet Signing (Client-Side)

The agent's x402 client SDK:
1. Parses `PAYMENT-REQUIRED` to get payment requirements
2. Constructs an EIP-712 typed data payload with `TransferWithAuthorization` (EIP-3009)
3. Requests the wallet to sign via `eth_signTypedData_v4`
4. In MetaMask: user sees a prompt with the payment details (amount, asset, payTo)

The typed data structure:
- **Domain:** `{ name: "USDC", version: "2", chainId: 84532, verifyingContract: "0x..." }`
- **Primary type:** `TransferWithAuthorization`
- **Message:** `{ from, to, value, validAfter, validBefore, nonce }`

The wallet returns an EIP-712 signature (r, s, v).

**Note on MetaMask 13.38 bug:** Some MetaMask versions return incorrect `v` values. The client SDK should verify the signature by recovering the signer address and flipping `v` (27↔28) if the recovery doesn't match.

#### Step 4: Payment Payload Construction

The agent constructs a V2 payment payload:
```json
{
  "x402Version": 2,
  "paymentId": "pay_coke_1234567890",
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "1990000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x4c1171ef4784563d6142d285e5e2c5a3288051d1",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
  },
  "payload": {
    "authorization": {
      "from": "0xagent_wallet",
      "to": "0xmerchant_wallet",
      "value": "1990000",
      "validAfter": 0,
      "validBefore": 1712345678,
      "nonce": "0x..."
    },
    "signature": "0x..."
  },
  "signerAddress": "0xagent_wallet"
}
```

This is base64-encoded and sent as the `PAYMENT-SIGNATURE` header.

#### Step 5: Server Verification

Merchant server:
1. Decodes `PAYMENT-SIGNATURE` header
2. Calls `facilitator.verifyPayment(payload, requirements)`
3. Facilitator verifies:
   - The EIP-712 signature is valid and recovers to the `from` address
   - The `from` address has sufficient USDC balance
   - The `paymentId` has not been used before (replay protection)
   - The requirements match what the route defined (same wallet, amount, network, asset)
4. Returns `{ verified: true }` or throws with error reason

#### Step 6: On-Chain Settlement

1. Merchant calls `facilitator.settlePayment(payload, requirements)`
2. Facilitator submits USDC EIP-3009 transfer on-chain (agent → merchant)
3. Settlement is atomic — either the full transfer succeeds or it reverts
4. Facilitator returns `{ success: true, transaction: "0x..." }` with the real tx hash

#### Step 7: Content Delivery

1. Merchant confirms settlement success
2. Merchant wraps settlement data into `PAYMENT-RESPONSE` header (base64):
   ```json
   {
     "success": true,
     "transaction": "0x...",
     "network": "eip155:84532",
     "amount": "$1.99",
     "payer": "0xagent_wallet"
   }
   ```
3. Merchant responds with HTTP 200 and the content body
4. Agent receives both the content and the settlement receipt

### 6.3 Error Cases

| Scenario | HTTP Status | Error |
|---|---|---|
| No payment header sent | 402 | `"Payment required"` |
| Invalid signature format | 402 | `"Invalid payment signature"` |
| Accepted does not match requirements | 402 | `"No matching payment requirements"` |
| Insufficient USDC balance | 402 | `"Insufficient funds"` |
| Facilitator unreachable | 502 | `"Facilitator error"` |
| Product does not exist | 404 | `"Product not registered"` |
| Payment expired (timeout) | 402 | `"Payment expired"` |

---

## 7. Wire Format — Headers & Payloads

### 7.1 Header Encoding

All x402 headers are **base64-encoded JSON**. This avoids issues with HTTP header character restrictions and makes debugging easy (just `atob()` the header value).

### 7.2 PAYMENT-REQUIRED (Server → Client)

Sent on HTTP 402 responses. Contains the payment options the client can choose from.

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "https://merchant.com/resource/coke",
    "description": "Payment required for Coca-Cola Classic",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "1990000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x4c1171ef4784563d6142d285e5e2c5a3288051d1",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USDC",
        "version": "2",
        "assetTransferMethod": "eip3009"
      }
    }
  ]
}
```

Fields:
- `x402Version`: Protocol version (currently 2)
- `error`: Human-readable reason for the 402
- `resource`: Metadata about the requested resource
- `accepts[]`: Array of payment options the client can choose from
  - `scheme`: `"exact"` for exact USDC amount
  - `network`: CAIP-2 network identifier
  - `amount`: Price in micro-units (1 USDC = 1000000, so $1.99 = 1990000)
  - `asset`: Token contract address
  - `payTo`: Merchant's wallet address
  - `maxTimeoutSeconds`: How long this challenge is valid
  - `extra`: Scheme-specific metadata

### 7.3 PAYMENT-SIGNATURE (Client → Server)

Sent on the follow-up request with the signed payment.

```json
{
  "x402Version": 2,
  "paymentId": "pay_coke_1712345678",
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "1990000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x4c1171ef4784563d6142d285e5e2c5a3288051d1",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDC", "version": "2", "assetTransferMethod": "eip3009" }
  },
  "payload": {
    "authorization": {
      "from": "0xagent_wallet",
      "to": "0xmerchant_wallet",
      "value": "1990000",
      "validAfter": 0,
      "validBefore": 1712345978,
      "nonce": "0x..."
    },
    "signature": "0x..."
  },
  "signerAddress": "0xagent_wallet"
}
```

Fields:
- `paymentId`: Unique identifier for this payment (prevents replay)
- `accepted`: Must match EXACTLY one of the options from `PAYMENT-REQUIRED.accepts[]`
- `payload.authorization`: The EIP-3009 `TransferWithAuthorization` parameters (from, to, value, times, nonce)
- `payload.signature`: The EIP-712 signature bytes
- `signerAddress`: The wallet that signed (may differ from `from` in delegate scenarios)

### 7.4 PAYMENT-RESPONSE (Server → Client)

Sent on successful payment (HTTP 200) to provide settlement proof.

```json
{
  "success": true,
  "transaction": "0xabc123...",
  "network": "eip155:84532",
  "amount": "$1.99",
  "payer": "0xagent_wallet"
}
```

Fields:
- `success`: `true` if settlement was successful
- `transaction`: Real on-chain transaction hash (verifiable on block explorer)
- `network`: CAIP-2 network identifier
- `amount`: Display price for receipt purposes
- `payer`: The wallet that paid

---

## 8. Trust Model & Guarantees

### 8.1 What the Protocol Guarantees

| Concern | Guarantee | Mechanism |
|---|---|---|
| Payment is real | ✅ On-chain USDC transfer with verifiable tx hash | EIP-3009 `TransferWithAuthorization` settled by facilitator |
| Payer identity | ✅ Only the wallet that signed can be debited | EIP-712 signature recovery |
| No double-spend | ✅ Each `paymentId` can only be used once | Facilitator checks uniqueness |
| Payment is final | ✅ No chargebacks, no reversals | USDC on-chain settlement |
| Merchant wallet ownership | ✅ Verified at facilitator registration | Signed message proof |

### 8.2 What the Protocol Does NOT Guarantee

| Concern | Gap | Future Direction |
|---|---|---|
| Content delivery | ❌ Merchant can accept payment and return garbage | Signed content manifests (merchant commits to content hash on-chain before accepting payment) |
| Content quality | ❌ Protocol doesn't verify that delivered content matches description | Reputation systems, dispute resolution |
| Service availability | ❌ Merchant can go offline after taking payment | Staking/slashing bonds |
| Price stability | ❌ USDC value can fluctuate relative to fiat | Stablecoin design limits this vs. volatile crypto |

### 8.3 Comparison to Credit Cards

| Aspect | Credit Card | x402 |
|---|---|---|
| Settlement time | 2-30 days | ~10-30 seconds |
| Chargeback risk | High (buyer can reverse up to 120 days) | Zero (irreversible on-chain) |
| Merchant fees | 2-4% + $0.30 per tx | ~0 (just network gas on settlement) |
| Required infrastructure | Payment processor, PCI compliance, fraud detection | None (just a wallet + middleware) |
| User identity | Name, address, billing info | Just a wallet address |
| Geographic support | Varies by country | Global (anywhere with internet + wallet) |
| Minimum viable payment | ~$0.50 (fee-dominated) | ~$0.001 (limited by gas cost) |
| Recurring billing | Built-in | Not supported (pay-per-request only) |

### 8.4 The Trust Reality

In practice, x402 doesn't introduce new trust problems — it inherits the same ones as the existing web. When you pay NYT $4/month via credit card, you're trusting them to deliver the articles. x402 just changes the settlement mechanism to be instant, final, and fee-free. The content delivery trust problem is orthogonal and would require additional protocol layers or reputation systems to solve.

---

## 9. Real-World Adoption

### 9.1 Agentic Market (agentic.market)

As of mid-2026, the primary Bazaar directory indexes **1,621 services** across categories:

| Category | Example Services | Typical Price |
|---|---|---|
| **Inference** | Claude, ChatGPT, DeepSeek, Gemini, Groq, Hyperbolic | $0.001–$0.01 per request |
| **Data** | Nansen, CoinGecko, Messari, Wolfram\|Alpha, Tripadvisor | $0.01–$0.35 per request |
| **Search** | Perplexity, Exa, Tavily, Firecrawl, Browserbase | $0.001–$0.01 per request |
| **Infrastructure** | Alchemy RPC, QuickNode, Run402 Postgres | $0.001–$10 per request |
| **Media** | Deepgram STT, fal.ai image gen, Magnific upscaling | $0.01–$1 per request |
| **Social** | AgentMail, StableEmail, StablePhone calls | $0.001–$20 per request |

Networks: Base (eip155:84532), Solana, Polygon.

### 9.2 Notable Integrations

- **Coinbase CDP SDK**: Official documentation at `docs.cdp.coinbase.com/x402/welcome`
- **Alchemy Agentic Gateway**: Access blockchain APIs without API keys, pay per request
- **Run402**: AI-native Postgres with x402 auth
- **Dripstack**: Pay-per-Substack-article (agents buy individual posts without subscription)
- **E2B**: Secure cloud sandboxes for AI agents, x402 payment

### 9.3 Agent Ecosystem

The primary consumers of x402 services are AI agents:
- **Agentic Wallet CLI** (`npx skills add coinbase/agentic-wallet-skills`): wallet management for agents
- **Agent frameworks** (LangChain, Vercel AI SDK, etc.): integrate x402 payment into agent tool-use loops
- **Autonomous agents**: discover, evaluate, and purchase services without human intervention

---

## 10. Comparison to Alternatives

### 10.1 L402 / Lightning HTTP 402

| Aspect | L402 | x402 |
|---|---|---|
| Settlement layer | Bitcoin Lightning Network | Base / Solana USDC |
| Payment model | Streaming (per-second micropayments) | Per-request fixed price |
| Token | BTC (volatile) | USDC (stable) |
| Wallet | Lightning wallet | Any EVM wallet (MetaMask, etc.) |
| Adoption | Some API gateways (Lightning Labs) | 1,600+ services on Agentic Market |

### 10.2 Stripe / Traditional Payment Processors

| Aspect | Stripe | x402 |
|---|---|---|
| Setup | Merchant account, KYC, bank account | Just a wallet + middleware |
| Fees | 2.9% + $0.30 | ~$0.00 (gas only) |
| Settlement | 2-7 business days | ~10-30 seconds |
| Chargebacks | Buyer can reverse for 120 days | Irreversible |
| API keys | Required for each user | None (wallet IS identity) |
| Minimum payment | ~$0.50 practical minimum | ~$0.001 (gas-bound) |

### 10.3 API Key / Subscription Model

| Aspect | API Keys | x402 |
|---|---|---|
| User onboarding | Sign up, generate key, manage quota | Just connect wallet |
| Rate limiting | Per-key limits | Natural (pay per use) |
| Overages | Complex billing, invoicing | Impossible (balance-limited) |
| Anonymous usage | No (requires account) | Yes (just a wallet) |
| Server state | Database of keys + users + quotas | Stateless (just middleware) |

---

## 11. Glossary

| Term | Definition |
|---|---|
| **402** | HTTP status code "Payment Required" — the core protocol signal |
| **x402** | The protocol implementing HTTP 402 with crypto settlement |
| **Facilitator** | Remote service that verifies signatures and settles on-chain |
| **Bazaar** | Discovery layer that indexes x402 endpoints for agent search |
| **Agentic Market** | Production Bazaar at agentic.market |
| **PAYMENT-REQUIRED** | Response header containing payment options (base64 JSON) |
| **PAYMENT-SIGNATURE** | Request header containing signed payment payload (base64 JSON) |
| **PAYMENT-RESPONSE** | Response header containing settlement proof (base64 JSON) |
| **EIP-712** | Ethereum typed data signing standard — used for payment authorization |
| **EIP-3009** | Gasless USDC transfer via signed authorization — used for settlement |
| **CAIP-2** | Chain-agnostic network identifier format (e.g. `eip155:84532`) |
| **exact** | Payment scheme for fixed-price USDC payments |
| **payTo** | Merchant's wallet address that receives the USDC |
| **paymentId** | Unique identifier preventing replay attacks |
| **V2** | Current x402 protocol version (V2 header format) |
| **Facilitator URL** | `https://x402.org/facilitator` (production) |
| **SKU / productId** | Individual purchasable item on a merchant's server |
| **Dynamic routes** | Pattern where Bazaar auto-discovers products via `GET /products` |
