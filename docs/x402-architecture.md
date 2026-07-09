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
9. [Quality Control & Misinformation](#9-quality-control--misinformation)
10. [Content Discovery in the AI Age](#10-content-discovery-in-the-ai-age)
11. [Real-World Adoption](#11-real-world-adoption)
12. [Comparison to Alternatives](#12-comparison-to-alternatives)
13. [Glossary](#13-glossary)

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

The facilitator handles signature verification and on-chain USDC settlement. Importantly, **the facilitator is optional** — the SDK contains all the crypto logic and can run in-process.

#### Architecture: The facilitator is a pattern, not a dependency

There are two layers:

1. **`x402Facilitator` class** (`@x402/core/server`) — a local, in-process orchestrator that routes verify/settle calls to registered scheme handlers. It has hooks for before/after verify and settle, making it fully extensible.

2. **`HTTPFacilitatorClient`** (`@x402/core/server`) — one concrete implementation that delegates verify/settle to a remote HTTP endpoint. This is a thin wrapper over the same logic.

The actual crypto work (EIP-712 signature recovery, EIP-3009 `transferWithAuthorization` ABI encoding) lives in **`ExactEvmScheme`** (`@x402/evm`), which can be registered on either a local `x402Facilitator` or a remote one.

#### Option A: Use a remote facilitator (common, default)

```js
import { HTTPFacilitatorClient } from "@x402/core/server";
const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});
const server = new x402ResourceServer(facilitator);
```

The merchant's server sends verify/settle requests to `x402.org/facilitator` over HTTP. The merchant never touches gas, nonces, or on-chain transactions.

#### Option B: Run in-process (merchant does it themselves)

```js
import { x402Facilitator } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, {
  networks: ["eip155:84532"],
  // Provide a JSON-RPC provider URL and a gas-paying wallet
});

const server = new x402ResourceServer(facilitator);
```

The merchant runs everything locally. Signature verification uses `viem.recoverTypedDataAddress`. Settlement submits `USDC.transferWithAuthorization()` via JSON-RPC.

#### What value does the remote facilitator provide?

| Concern | With remote facilitator | Without (in-process) |
|---|---|---|
| **Gas fees** | Facilitator pays gas for settlement txs | Merchant must hold ETH on their server to pay gas |
| **Private key security** | Merchant's server never holds a gas-paying key | Merchant must store a private key for gas on their server |
| **Nonce management** | Facilitator coordinates EIP-3009 nonces globally | Merchant must track nonces per-payer themselves |
| **USDC balance check** | Facilitator checks balance before settling | Merchant must check balance via RPC |
| **Replay protection** | Facilitator checks `paymentId` uniqueness | Merchant must track used `paymentId`s themselves |
| **Failure recovery** | Facilitator handles retries and reversions | Merchant must implement retry logic |

The remote facilitator is primarily a **convenience layer** that shifts operational burden (gas, nonces, monitoring) off the merchant's server. The protocol itself is decentralized — any of these can run locally.

#### How it works (remote flow)

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

### 8.4 Content Delivery Trust — Practical Reality

The "merchant can take payment and not deliver" concern is real but largely theoretical for how x402 is actually used today.

**Most services are synchronous API calls, not async delivery.** Looking at the 1,623 services on Agentic Market:
- LLM inference (Claude, ChatGPT, DeepSeek) — pay $0.001, get the API response immediately
- Data queries (CoinGecko, Nansen, Wolfram|Alpha) — pay $0.01, get structured data back
- Infrastructure (Alchemy RPC, QuickNode) — pay per RPC call, get the result
- Search (Perplexity, Exa, Tavily) — pay $0.001, get search results

In all these cases, **the content IS the HTTP response body**. The merchant can't "not deliver" — the response IS the product. If they returned a 200 with empty body, you'd know in milliseconds and stop using them. There's no delayed fulfillment, no download-later model.

**Incentives strongly discourage cheating:**
- Most merchants are established companies (Alchemy, Nansen, CoinGecko, Perplexity, Deepgram, Tripadvisor)
- They're identifiable by their Bazaar description, domain, and registered wallet
- Cheating for $0.001 per request would destroy their reputation and Bazaar listing instantly
- The facilitator can de-register wallets that violate terms

**The one edge case is Dripstack** (pay-per-Substack-article at $0.10–$0.20). Even here, the article body is returned in the synchronous HTTP response. You know immediately if you got the content or garbage.

---



## 9. Quality Control & Misinformation

The harder problem — even if the merchant delivers *something*, how do you know it's correct? This is not unique to x402; it's the same question you'd ask about any API, any website, or any LLM.

### 9.1 The problem is the same on the regular web

| Scenario | Traditional web | x402 |
|---|---|---|
| You ask an LLM a question | Could hallucinate | Could hallucinate |
| You buy data from an API | Could be stale/wrong | Could be stale/wrong |
| You read a news article | Could be misinformation | Could be misinformation |
| You hire a freelancer | Could deliver bad work | N/A in x402 |

The payment method (credit card vs. USDC) doesn't change whether the information is correct. Quality is a property of the **data source**, not the payment rail.

### 9.2 What actually enforces quality

**1. Merchant identity is pseudonymous but persistent.**
A wallet address is like a username — you don't know the real person, but you can track their history. If `0xabc...` serves bad data, every agent on the network can see it and stop calling them. Starting over with a new wallet means losing their Bazaar listing, any accumulated reputation, and the facilitator registration fee.

**2. Brand-name merchants have brand risk.**
Alchemy, Nansen, CoinGecko, Perplexity, Deepgram — these are public companies with reputations. They're not going to serve bad data for $0.001 per call. Their x402 endpoints are backed by the same infrastructure as their paid API products.

**3. Agents can verify outputs programmatically.**
An agent querying CoinGecko for ETH price can cross-reference with another source. An agent calling an LLM can check for internal consistency. The agent is not blindly trusting — it's consuming data and can validate it before acting on it.

**4. The market punishes bad actors naturally.**
If a merchant starts serving garbage, agents stop buying. The merchant's revenue drops to zero. There's no contract lock-in, no subscription to cancel — just a wallet that nobody pays anymore. This is stronger enforcement than credit card chargebacks, which take days and have limits.

**5. Bazaar-level curation (evolving).**
Agentic Market curates its listings. Merchants must validate their endpoints to be indexed. In the future, Bazaars could add:
- Verified badges (domain-verified, KYC'd, etc.)
- Community ratings and reviews
- Automated quality probes that periodically test endpoints
- Staking requirements (merchant deposits collateral, slashed on verified fraud)

### 9.3 How this compares to API keys

With traditional API keys:
- You trust a brand name (e.g. you sign up for "CoinGecko API" because you know the brand)
- You pay upfront (monthly subscription) and hope the quality is worth it
- If quality drops, you cancel and eat the sunk cost

With x402:
- You don't need to know the brand — you can try a service for $0.001
- If quality is bad, you lose $0.001, not $100/month
- You can switch providers instantly with zero migration cost
- The low barrier to try means the market self-corrects faster

### 9.4 The honest answer

> For high-value, high-trust scenarios (medical data, financial advice, legal research), you should use known, verified providers — same as you would today. x402 doesn't solve blind trust. What it solves is: once you've identified a provider you trust, you can pay them per-request with no friction, no API key, no account, and instant settlement.

For low-value, high-volume scenarios (LLM inference, market data, search results), the combination of tiny per-request cost + merchant reputation + agent-side verification is sufficient. The economics don't justify cheating.

---

## 10. Content Discovery in the AI Age

### 10.0 The Content Creator Crisis

Before discussing the technical solutions, it's important to understand who's being hurt by the transition and why this matters.

#### The two-legged stool: how the old web paid creators

For 25 years, content creators on the open web had two revenue models:

| Model | How it worked | Who used it |
|---|---|---|
| **Advertising** | Create free content → attract readers → sell ad space (Google AdSense, display ads) | Bloggers, news sites, recipe sites, review sites |
| **SEO + affiliate** | Optimize content for Google → rank high → readers click affiliate links → earn commission | Product reviews, comparison sites, "best X" articles |
| **Both** | Most creators combined ads + affiliate links | Nearly everyone |

Both models depended on **Google sending traffic**. If Google ranked your article #1, you got thousands of visitors → ad impressions → affiliate commissions. The content itself was the bait; the ad/clicks were the revenue.

#### The hard data: Cloudflare's 2026 agentic internet report

Cloudflare sits at the intersection of this shift — more than 20% of the web sits behind their network. On July 1, 2026, they published their annual report on the state of the agentic internet. Key findings:

| Finding | Data point | Source |
|---|---|---|
| **Non-human traffic** | More than 50% of Internet traffic is now non-human | [Cloudflare Agentic Internet Report, July 2026](https://blog.cloudflare.com/agentic-internet-bot-report/) |
| **AI crawler growth** | 52% of crawler requests are for AI training (up from 22% in Spring 2025) | Same |
| **AI adoption speed** | 2.5B users (30% of humanity) adopted generative AI in 3.5 years — 2x faster than smartphones | Same |
| **Open web usage collapse** | For every hour searching online, only 15 minutes is on the open web | Same |
| **Traffic decline** | Some heavily crawled industries saw human traffic decline up to 40% in under a year | Same |
| **Crawl-to-refer ratios** | Anthropic: ~50,000 crawls per 1 referral. OpenAI: ~887:1. Perplexity: ~118:1 | [Cloudflare Radar AI Insights, Aug 2025](https://blog.cloudflare.com/ai-crawler-traffic-by-purpose-and-industry/) |
| **AI Overviews click collapse** | When Google shows an AI summary, users click a traditional result only 8% of the time (vs ~15% without) | [Pew Research Center, July 2025](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/) cited by [Cloudflare, July 2026](https://blog.cloudflare.com/making-ai-search-smarter/) |
| **Links inside AI summaries** | Users click a link inside an AI summary only 1% of the time | Same |
| **Google's mixed-use crawler advantage** | Google has access to ~2x more publisher content than other AI companies because its crawler combines search + AI training in one bot | [Cloudflare Agentic Internet Report](https://blog.cloudflare.com/agentic-internet-bot-report/) |
| **Google referral dominance** | Google accounts for ~88% of referral traffic, but increasingly keeps users in AI experiences | Same |
| **Publisher-AI licensing deals** | 50+ publisher-AI agreements signed since 2023 | Same |
| **Wasted crawl traffic** | More than 50% of crawler requests go to re-fetching pages that haven't changed | [Cloudflare, Making AI Search Smarter, July 2026](https://blog.cloudflare.com/making-ai-search-smarter/) |

> **The bottom line:** AI crawlers now request content anywhere from a hundred to tens of thousands of times for every visitor they send back. The old bargain — let us crawl, we'll send you traffic — is broken. As Cloudflare puts it: *"If content is consumed without audiences ever visiting the source, how do content creators sustain themselves?"*

#### What AI broke

Three simultaneous disruptions destroyed the creator economy:

**1. AI Overviews stole the click.** When Google shows an AI summary, click-through drops from ~15% to ~8% for traditional results, and links inside the summary get clicked only 1% of the time ([Pew Research, 2025](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/)). The content is consumed; the creator gets nothing.

**2. AI chatbots replaced search.** Users ask ChatGPT, Claude, or Perplexity directly instead of Googling. These models were trained on the creator's content but return the answer without attribution or payment. The creator gets no traffic, no ad views, no affiliate clicks.

**3. AI content saturated the SERP.** Google's search results flooded with AI-generated content — mass-produced articles, auto-generated reviews, SEO-optimized slop. Even when users do click through, they land on content that was likely trained on the original creator's work.

#### Who's been hurt most

**Small independent bloggers and niche sites** — hit hardest. They had no brand recognition, no direct traffic, no email lists. Their entire business was Google rankings. Many have shut down or stopped publishing.

**Recipe sites, tutorial sites, "how-to" sites** — devastated. These are the most common targets for AI Overviews. A recipe blog that got 200k visitors/month from Google might now get 50k.

**Local news and mid-market publishers** — severely damaged. Already struggling from the 2010s ad recession, AI Overviews further cratered their traffic. Layoffs continue across the industry.

**Affiliate marketers and review sites** — functionally destroyed. Google's helpful content update + AI Overviews meant review queries now show AI summaries with Amazon links embedded. The affiliate middleman is cut out.

**Who's relatively fine** — large established media brands (NYT, WSJ, The Guardian) with subscription revenue, direct traffic, and brand recognition. YouTube creators (search is internal to YouTube, not Google). Platforms like Substack (email-based, not search-dependent).

#### What creators are doing

| Strategy | Example | Works? |
|---|---|---|
| Pivot to subscription | NYT, Substack, Patreon | Yes, but hard to build from zero |
| Build email lists | Newsletters, direct audience | Yes, but slow |
| Go behind paywalls | Paid newsletters, member-only content | Works for established creators |
| Chase AI training licensing | Sell content for model training | One-time payments, not sustainable |
| Quit | Stop publishing, get a regular job | Increasingly common |
| **x402 / pay-per-access** | Charge per-article via x402 | New — potential but unproven |

#### Why this context matters for x402

The creator crisis is the **demand-side driver** for the x402 ecosystem. Without it, x402 is a neat protocol looking for a problem. With it, x402 is the answer to the question: "how do creators get paid when traffic and ads no longer work?"

The rest of this section explores the technical and business infrastructure being built to answer that question.

### 10.1 The Shift: From Human Browsing to Agent Consumption

The web was designed for human eyes — HTML pages with navigation, ads, styling, and interactive elements. Search engines (Google, Bing) crawled and indexed these pages so humans could find them. This created the SEO industry: optimizing content to rank well in search results.

Two shifts are changing this model:

1. **AI-generated answers** — Google AI Overviews, Perplexity, ChatGPT Browse, and Claude now read web pages and summarize the answer directly in the chat. Users don't click through to the source as often. The content still needs to exist and be crawlable, but the click-through reward diminishes.

2. **Agent-driven consumption** — AI agents (not humans) browse the web, call APIs, and consume content programmatically. An agent doesn't read a beautifully designed HTML page — it wants structured data, clean markdown, or a direct API call.

### 10.2 Is SEO Dead?

**No, but it's evolving.** Google's own ad revenue tells the story:

- Google's ad revenue has remained stable or grown despite AI Overviews
- AI Overviews include ads — Google integrated its ad system into AI-generated answers
- Search query volume continues to grow (new users, new markets, new types of queries)
- Google still controls the largest distribution channel on earth

What IS dying is **manipulative SEO** — keyword stuffing, content farms, link schemes, mass-produced AI slop designed purely to rank. Google's E-E-A-T framework (Experience, Expertise, Authoritativeness, Trustworthiness) explicitly devalues this. Their 2024-2025 spam updates targeted scaled content abuse and expired domain abuse.

**What still works for human-facing SEO:**
- Genuinely helpful, original content (Google's "people-first" guidance)
- Clear authorship and expertise signals (bylines, author pages)
- Structured data (schema.org markup)
- Strong backlink profiles from authoritative sources
- Good page experience (Core Web Vitals)

### 10.3 Why Google Isn't Losing Ad Revenue

| Reason | Explanation |
|---|---|
| **AI Overviews include ads** | Google places ads within and alongside AI-generated answers — ad slots actually increased |
| **Search volume still grows** | More queries = more ad impressions, even if click-through rate per query drops |
| **Zero-click isn't zero-revenue** | Google can show an ad on a zero-click search; the user sees the ad even without visiting a website |
| **YouTube growth** | YouTube ad revenue (connected to search) continues to grow double-digits year over year |
| **Monopoly advantage** | No credible competitor has challenged Google's search + ad distribution at scale |
| **Cloud revenue diversification** | Google Cloud is now profitable and growing, offsetting any search slowdown |

The net effect: **content creators lose traffic, Google keeps the revenue.** The publisher (the website that wrote the article) gets fewer clicks, but Google captures the ad value that those clicks would have generated.

### 10.4 Content Discoverability for AI Models

If agents and LLMs are the new consumers, how do you make content discoverable by them? Several emerging standards and practices:

#### /llms.txt (The New robots.txt)

Proposed by Jeremy Howard (fast.ai) in September 2024, `/llms.txt` is a markdown file in a website's root that provides LLM-friendly content:

```markdown
# FastHTML

> FastHTML is a python library which brings together Starlette, Uvicorn, HTMX,
  and fastcore's `FT` "FastTags" into a library for server-rendered hypermedia.

## Docs
- [Quick start](https://fastht.ml/docs/tutorials/quickstart_for_webdevs.html.md):
  A brief overview of many FastHTML features

## Optional
- [Starlette docs](https://starlette.io/docs.md):
  Subset useful for FastHTML development
```

Purpose: Tell LLMs what your site is about, where the important content lives, and which files contain clean markdown versions. Unlike `robots.txt` (which blocks crawlers), `llms.txt` invites them and provides a curated starting point.

Adoption (mid-2026): Agentic Market, FastHTML, nbdev projects, and a growing directory at `llmstxt.site`.

#### Structured Data / Schema.org

Schema.org markup (JSON-LD) remains the most reliable way to tell machines what your content means. It's used by Google, Bing, and increasingly by AI training pipelines:

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "...",
  "author": { "@type": "Person", "name": "..." },
  "datePublished": "2026-01-01"
}
```

#### API-First Content (The x402 Model)

The most native way for agents to consume content: expose a structured API instead of (or alongside) an HTML page. This is what x402 enables:

```http
GET /resource/article-123
Accept: application/json
PAYMENT-SIGNATURE: ...
```

Response:
```json
{
  "resource": {
    "title": "Deep Dive",
    "body": "...",
    "author": "...",
    "published": "2026-01-01"
  },
  "settlementResponse": { "success": true, "transaction": "0x..." }
}
```

The agent pays $0.10 and gets a clean JSON response — no parsing HTML, no ads, no navigation to strip. The merchant knows exactly what they're delivering and gets paid per-response.

#### Being in Training Data

Models are trained on web crawls (Common Crawl, C4, etc.). Content that is:
- Well-structured (clean HTML, clear headings, semantic markup)
- Linked from authoritative sources
- Regularly updated

...is more likely to be included in training data. This feeds the model's knowledge, making it more likely to reference your content in answers (with or without attribution).

#### Bazaar / Discovery Directories

For agent-to-service commerce, directories like Agentic Market (`agentic.market`) serve the same role as Google for human-facing content. An agent queries:

```
GET https://agentic.market/v1/services/search?q=article+about+semiconductors
```

And gets back machine-readable results with pricing, endpoints, and capabilities. This is the equivalent of SEO for the agent economy — but instead of optimizing for Google's ranking algorithm, you optimize for the Bazaar's search index.

### 10.5 The Two-Layer Strategy

For a content creator preparing for the agent era:

| Layer | What | Example | For whom |
|---|---|---|---|
| **Human-facing** | Beautiful HTML pages, SEO, social media | blog.nytimes.com | Human readers, Google search |
| **LLM-friendly** | `/llms.txt`, clean markdown versions | blog.nytimes.com/llms.txt | ChatGPT, Claude, Perplexity |
| **Agent-accessible** | Structured API, x402 endpoint | api.nytimes.com/x402 | AI agents, programmatic access |

Each layer feeds into the next. A human discovers the content via Google → tells an agent about it → agent accesses it via API. Or an agent discovers it directly via Bazaar → pays per article → returns the content to the user.

### 10.6 What This Means for x402

x402 is uniquely positioned for the agent era because it solves two problems simultaneously:

1. **Payment** — agents can pay per-request without accounts, API keys, or subscriptions
2. **Discovery** — the Bazaar/Agentic Market model gives agents a structured directory to find services

Traditional SEO optimized content for Google's crawler. The agent-era equivalent is: **optimize your content for structured, pay-per-request API access + Bazaar discovery.** An HTML article behind a Stripe paywall is invisible to agents. The same article as an x402 endpoint is instantly consumable.

### 10.7 Companies Building in This Space

Several companies and projects are targeting different parts of the AI-era content discovery stack:

#### Agent-to-Service Commerce (x402 / Agentic Market)

| Company / Project | What they do | Backed by |
|---|---|---|
| **Agentic Market** (`agentic.market`) | Bazaar directory indexing 1,624 x402 services — LLMs, data APIs, search, infrastructure | Coinbase CDP protocol |
| **Coinbase CDP x402** | Protocol SDK (`@x402/core`, `@x402/evm`, `@x402/express`) — the infrastructure layer for x402 endpoints | Coinbase |
| **Agentic Wallet CLI** (`npx skills add coinbase/agentic-wallet-skills`) | CLI wallet for agents to discover and pay for x402 services | Coinbase |
| **Run402** | AI-native Postgres with x402 auth — database as a pay-per-request API | Independent |
| **Dripstack** | Pay-per-Substack-article via x402 — agents access individual paywalled posts | Independent |
| **Cloudflare Monetization Gateway** | Managed x402 gateway — Cloudflare customers can charge for any page, API, dataset, or MCP tool behind Cloudflare; no payment infrastructure to build | Cloudflare (public, NYSE: NET) |

These form a vertically integrated stack: SDK → wallet → directory → merchant endpoints. The same company (Coinbase) backs the protocol layer, the wallet tooling, and the discovery directory.

#### /llms.txt Ecosystem

| Company / Project | What they do |
|---|---|
| **llmstxt.site** | Directory of websites with `/llms.txt` files — the Google-equivalent index for LLM-friendly content |
| **directory.llmstxt.cloud** | Alternative directory for discovering `/llms.txt` enabled sites |
| **llms_txt2ctx** | CLI tool (Python) that expands `/llms.txt` into full LLM context files |
| **vitepress-plugin-llms** | Auto-generates `/llms.txt` from VitePress documentation sites |
| **docusaurus-plugin-llms** | Auto-generates `/llms.txt` from Docusaurus documentation sites |
| **PagePilot (VS Code)** | VS Code extension that loads `/llms.txt` context for AI coding assistance |

Adoption as of mid-2026: thousands of sites including Apache Camel, Vite, Next.js, Postman, DreamHost, CarParts.com, WeatherBug, Pepperfry, Barco, Hyperliquid, and many more. Notably, **it's mostly documentation sites and e-commerce** — not news or content publishers yet.

#### AI-Native Search Engines

| Company | Product | Business Model |
|---|---|---|
| **Perplexity** | AI search with citations, source transparency | Subscription ($20/mo Pro) + ads (planned) |
| **You.com** | AI-powered search with app integration | Subscription + API usage |
| **Google** | AI Overviews in search results | Ads (same business model, more ad slots) |

These are the primary consumers of web content in the AI era — they crawl pages, summarize answers, and cite sources. They don't pay publishers for the content they use (except Perplexity's publisher revenue share program, which is nascent).

#### Agent Frameworks & Tooling

| Company / Project | What they do | Agent Integration |
|---|---|---|
| **LangChain** | Agent framework with tool-use loops | Can integrate x402 as a tool |
| **Vercel AI SDK** | AI SDK with tool calling | Can integrate x402 as a tool |
| **Coinbase Agentic Wallet** | CLI wallet + skills | Native x402 payment support |
| **OpenAI / Anthropic** | LLM providers with browsing capability | Models can discover and consume web content but don't pay for it |

These frameworks are the distribution channel for agent-driven commerce — when an agent needs a service, it uses a tool/framework to discover, evaluate, and pay.

#### Traditional SEO Adapting

| Company | Adaptation |
|---|---|
| **Semrush, Ahrefs, Moz** | Adding AI content scoring, AI overview tracking, and "optimize for AI answers" features |
| **BrightEdge** | AI content performance tracking — how often your content appears in AI-generated answers |
| **Schema.org** | Structured data standard — increasingly used by AI training pipelines, not just Google |

The traditional SEO industry is repositioning from "rank in Google's 10 blue links" to "appear in AI-generated answers." The tools are the same (structured data, content quality, authority signals) but the optimization target is different.

#### Cloudflare's Bet: The Monetization Gateway (July 2026)

On July 1, 2026, Cloudflare announced the **Monetization Gateway** — a managed service that lets any Cloudflare customer charge for any resource behind Cloudflare via x402. This is the most significant validation of the x402 protocol to date.

**Key announcements in their Content Independence Day 2026 launch:**

| Product | What it does |
|---|---|
| **Monetization Gateway** | Charge for any web page, dataset, API, or MCP tool via x402. Set rules like "charge $0.01 for every POST to /api/premium/*" in the Cloudflare dashboard or via Terraform. No billing infrastructure needed. |
| **Pay Per Crawl** | AI crawlers (Perplexity, OpenAI, etc.) pay publishers per-request for crawled content. Cloudflare enforces payment at the edge before the request reaches the origin. |
| **AI Traffic Controls** | Granular bot classification — distinguish Search bots, Agent bots, and Training bots. Block, rate-limit, or charge each category differently. |
| **Attribution Business Insights** | Dashboard showing which AI crawlers access your content, how often, and potential revenue — fuel for crawl compensation negotiations. |
| **Temporary Accounts for AI agents** | Agents can create Cloudflare accounts, buy domains, and deploy Workers — without a human in the loop. |

**The x402 Foundation**: Alongside the gateway, Cloudflare and Coinbase announced the **x402 Foundation** under the Linux Foundation, with 25+ industry leaders joining. This moves x402 from a Coinbase-led protocol to an open industry standard.

**What this means for content creators:**
- A blogger on Cloudflare can flip a switch to charge AI crawlers $0.001 per article crawl
- An API provider can set per-request pricing without building a billing system
- An independent creator gets the same payment infrastructure as a Fortune 500 company
- Settlement is in stablecoins (USDC, Open USD) — sub-cent fees, instant, irreversible

Cloudflare's thesis: "The agent becomes the primary buyer on the Internet, and the request becomes the transaction." They're positioning their edge network (330+ cities) as the natural place to verify payment before the request ever reaches the origin.

### 10.8 The Full Stack: End-to-End Architecture

The agent-era internet requires a new stack with distinct layers. Here is the complete picture, from content creation to agent consumption:

```
  AGENT / USER LAYER
  ┌───────────────────────────────────────────────────────────────┐
  │  AI Agents · Chatbots · Autonomous Bots                      │
  │  (Claude, ChatGPT, Perplexity, custom agents)                │
  │  Wallet: Coinbase Agentic Wallet · MetaMask · Embedded       │
  └───────────┬───────────────────────────────────────────────────┘
              │ discovers services       │ calls endpoints
              ▼                          ▼
  ┌──────────────────────┐  ┌─────────────────────────────────────┐
  │ DISCOVERY LAYER      │  │ PAYMENT ENFORCEMENT LAYER           │
  │                      │  │                                     │
  │ Bazaar / Agentic     │  │ Cloudflare Monetization Gateway     │
  │   Market             │  │ Self-hosted x402 middleware          │
  │ /llms.txt directories│  │ (@x402/express on your server)       │
  │ AI search engines    │  │ Facilitator (x402.org or in-process) │
  │ (Perplexity, Google) │  │                                     │
  └──────────────────────┘  └──────────────┬──────────────────────┘
                                           │ forwards verified request
                                           ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ CONTENT / SERVICE LAYER                                       │
  │                                                               │
  │  Publishers  │  API Providers  │  SaaS  │  MCP Tools          │
  │  (NYT, blogs)│  (CoinGecko,    │  (Run402,  │  (agent tools)  │
  │              │   Nansen, ...)  │   Alchemy) │                 │
  └──────────────┴─────────────────┴────────────┴─────────────────┘
              │ gets paid
              ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ SETTLEMENT LAYER                                              │
  │                                                               │
  │  x402 Facilitator → On-chain USDC (Base, Solana)              │
  │  Stablecoin settlement: USDC, Open USD                        │
  │  Sub-second · sub-cent fees · irreversible                    │
  └───────────────────────────────────────────────────────────────┘
```

#### Layer 1: Content / Service (The supply side)

**What it is:** The actual resource being paid for — a web page, API response, dataset, LLM inference, compute, or tool invocation.

**Who provides it:**
- **Publishers & creators:** Independent bloggers, news outlets (NYT, Substack), documentation sites
- **API providers:** CoinGecko, Nansen, Alchemy, Wolfram|Alpha, Tripadvisor — data and infrastructure sold per-request
- **SaaS platforms:** Run402 (Postgres), QuickNode (RPC), E2B (sandboxes), StableEmail (email)
- **MCP / tool providers:** Agent tools that require payment per invocation

**Revenue model before x402:** Ads, subscriptions, API keys with monthly billing. All required user accounts, payment processor integration, and chargeback risk. x402 converts them to pay-per-request with zero onboarding cost.

**Key companies:** Nansen, Alchemy, CoinGecko, Deepgram, Tripadvisor, Perplexity, Run402, QuickNode, E2B, Browserbase, Firecrawl, Dripstack, and hundreds more on Agentic Market.

#### Layer 2: Payment Enforcement (The toll booth)

**What it is:** The middleware that intercepts requests, returns 402 with pricing, verifies payment, and only forwards to the origin if payment is valid.

**Two deployment models:**

| Model | How it works | Who runs it | Best for |
|---|---|---|---|
| **Self-hosted middleware** | `@x402/express` on the merchant's server | The merchant | Custom setups, full control |
| **Managed edge gateway** | Cloudflare Monetization Gateway | Cloudflare (330+ cities) | Anyone behind Cloudflare, zero config |

**What it handles:**
- Parsing `PAYMENT-SIGNATURE` headers
- Calling the facilitator for verification
- Caching verification results for performance
- Returning 402 or forwarding to origin

**Key companies:** Cloudflare (Monetization Gateway), Coinbase (@x402 SDK), the merchant themselves (self-hosted).

#### Layer 3: Discovery / Indexing (The directory)

**What it is:** Where agents find services. The equivalent of Google for the agent economy.

**Three discovery channels:**

| Channel | Example | How agents use it |
|---|---|---|
| **Bazaar directory** | Agentic Market (`agentic.market/v1/services`) | API call → structured JSON with pricing, endpoints, capabilities |
| **/llms.txt** | `blog.example.com/llms.txt` | LLM reads markdown → knows the site's content and structure |
| **Web search (AI-native)** | Perplexity, Google AI Overviews | Agent asks a question → search engine crawls and summarizes |

These are complementary. An agent might discover a service via Perplexity, then access it directly via x402 for the full content.

**Key companies:** Agentic Market (Coinbase), llmstxt.site, Perplexity, Google, You.com.

#### Layer 4: Agent Framework & Wallet (The consumer infrastructure)

**What it is:** The software that agents use to discover, evaluate, and pay for services.

**Sub-layers:**

| Component | What it does | Key players |
|---|---|---|
| **Wallet** | Holds USDC, signs EIP-712 payments | Coinbase Agentic Wallet, MetaMask, embedded wallets |
| **Framework** | Orchestrates discovery → payment → consumption | LangChain, Vercel AI SDK, custom agents |
| **Agent runtime** | Runs the agent, manages context | Claude (Anthropic), ChatGPT (OpenAI), custom runtimes |

**The payment flow inside an agent:**
1. Agent needs data (e.g. "what's the latest ETH price?")
2. Agent searches Bazaar or web → finds CoinGecko x402 endpoint
3. Agent's wallet signs the payment (EIP-712 typed data)
4. Agent sends `PAYMENT-SIGNATURE` header with the request
5. Agent receives the data → validates it → uses it

**Key companies:** Coinbase (Agentic Wallet), LangChain, Vercel, Anthropic, OpenAI.

#### Layer 5: Settlement (The financial rail)

**What it is:** The actual transfer of value — verifying signatures, moving USDC from buyer to seller on-chain.

**Key properties:**
- **Speed:** ~10-30 seconds (Base/Solana block time)
- **Cost:** fractions of a cent (no payment processor middleman)
- **Finality:** irreversible once settled (no chargebacks)
- **Rail agnostic:** currently Base and Solana USDC, extensible to any chain

**Key players:** x402 facilitator (`x402.org`), Circle (USDC), Open USD, Base (Coinbase), Solana.

#### How the layers fit together (worked example)

An agent wants to research semiconductor stocks:

1. **Agent framework** (Layer 4) decides it needs financial data
2. **Discovery** (Layer 3): Agent queries Agentic Market → finds `edgar.apitoll.cloud` (SEC filings API, $0.003/call)
3. **Payment enforcement** (Layer 2): Agent calls the API → Cloudflare edge intercepts → returns 402 with price
4. **Agent wallet** (Layer 4): Signs the EIP-712 payload
5. **Agent retries** with `PAYMENT-SIGNATURE` header
6. **Payment enforcement** verifies via facilitator → forwards to origin
7. **Content** (Layer 1): Server returns structured SEC filing data
8. **Settlement** (Layer 5): Facilitator settles $0.003 USDC on-chain → merchant gets paid

Total time: ~15 seconds. Cost: $0.003 + gas. No accounts, no API keys, no subscriptions.

#### The economic flow

```
                    $0.003 USDC
  Agent ◄────────────────────────────── Merchant
    │                                       │
    │  $0.003 USDC                           │
    ├────────────────────────────────────────┤
    │  (facilitator settles on-chain)        │
    │                                        │
    │  $0 (gas paid by facilitator or        │
    │   deducted from settlement)            │
```

The agent pays exactly $0.003. The merchant receives exactly $0.003 minus network gas (typically <$0.001). No payment processor takes 2.9% + $0.30. No monthly subscription. No chargeback risk.

### 10.9 The AI Crawler Problem: Paying for Content Access

A critical gap remains: **AI search engines (Perplexity, Google AI Overviews, ChatGPT Browse) and AI training crawlers (GPTBot, ClaudeBot, Google-Extended) do not pay for the content they consume.** They crawl public web pages, summarize them in answers, and use them for training — all without compensating the publisher.

#### The current state of AI crawler payment

| Crawler | Pays publishers? | Mechanism | Notes |
|---|---|---|---|
| **Perplexity** | Partial | Revenue share program (opt-in) | Tiny payments, few publishers enrolled |
| **Google (AI Overviews)** | No | None | Lawsuits pending (NYT, others) |
| **OpenAI (ChatGPT Browse)** | No | None | Deals with select publishers (Axel Springer, etc.) — exclusive, not universal |
| **Anthropic (Claude)** | No | None | Lawsuits pending (music publishers, authors) |
| **Meta (LLAMA)** | No | None | Scraped books, lawsuit ongoing |

The fundamental problem: **AI crawlers operate on a "crawl everything, pay nothing" model.** They extract value from publisher content and return no compensation. Traditional search (Google) at least sent traffic and ad revenue — AI search sends neither.

#### Why they can't pay via x402 today

Even if a publisher sets up an x402 paywall at the edge (via Cloudflare Monetization Gateway or self-hosted middleware), AI crawlers would simply skip those pages because:

1. **No wallet:** GPTBot, ClaudeBot, and Googlebot don't carry USDC wallets
2. **No x402 client:** Their crawler software doesn't understand `PAYMENT-REQUIRED` headers
3. **No budget:** AI companies haven't allocated crawl budgets for paid content
4. **No incentive:** They can currently train on free public content — paying would only reduce margins

#### The chicken-and-egg problem

```
Publishers: "We'll require payment when crawlers can pay"
Crawlers:  "We'll implement payment when enough content requires it"
```

Neither side moves first. Cloudflare's Pay Per Crawl and Monetization Gateway are designed to break this deadlock by making it trivially easy for publishers to set prices, but the crawler side still needs to show up with wallets.

#### The path forward

**Phase 1 — API providers monetize (2025-2026):** LLMs, data APIs, infrastructure. This is working today — 1,624 services on Agentic Market. The content is API responses, not web pages. The buyer is an agent with a wallet, not a crawler.

**Phase 2 — SaaS and tools monetize (2026):** Pay-per-use database (Run402), pay-per-article (Dripstack), pay-per-email (StableEmail). The buyer is still an agent.

**Phase 3 — AI crawlers pay for crawl access (2026-2027):** Cloudflare's initiative. If a critical mass of publishers behind Cloudflare require x402 payment for AI crawler access, the crawlers will be forced to implement payment or lose access to that content. This requires:
- AI companies to adopt x402 on their crawler side (unlikely voluntarily)
- Regulatory pressure (EU AI Act, copyright lawsuits)
- Publishers to collectively enforce payment (coordination problem)

**Phase 4 — Real-time AI search includes paid content (2027+):** Perplexity, Google, or ChatGPT could offer a "premium search" tier where the search engine pays publishers per-article via x402 and passes the cost to the user as a subscription or per-query fee.

#### The honest assessment

> As of mid-2026, AI crawlers do not pay for content and show no signs of doing so voluntarily. x402 and Cloudflare have built the infrastructure for them to pay — but adoption requires either legal pressure, collective publisher action, or a critical mass of content going behind x402 paywalls. The current market (1,624 API services) is mostly agent-to-API commerce, not crawler-to-publisher payment. That may change, but it hasn't yet.

#### What's Missing

| Gap | Why | Opportunity |
|---|---|---|
| **AI crawler wallets** | No crawler carries USDC or understands 402 | Cloudflare / Coinbase working on this |
| **Content verification / fact-checking service** | No scalable fact-checking API for agents | Massive — agents need to verify outputs |
| **Cross-referencing / reputation for agents** | No on-chain reputation for merchants | Staking, slashing, dispute resolution |
| **Bazaar for non-crypto publishers** | Agentic Market serves crypto-native merchants; no equivalent for NYT, WSJ | x402 works for any publisher — just needs adoption |

---

## 11. Real-World Adoption

### 11.1 Agentic Market (agentic.market)

As of mid-2026, the primary Bazaar directory indexes **1,623 services** across categories:

| Category | Example Services | Typical Price |
|---|---|---|
| **Inference** | Claude, ChatGPT, DeepSeek, Gemini, Groq, Hyperbolic | $0.001–$0.01 per request |
| **Data** | Nansen, CoinGecko, Messari, Wolfram\|Alpha, Tripadvisor | $0.01–$0.35 per request |
| **Search** | Perplexity, Exa, Tavily, Firecrawl, Browserbase | $0.001–$0.01 per request |
| **Infrastructure** | Alchemy RPC, QuickNode, Run402 Postgres | $0.001–$10 per request |
| **Media** | Deepgram STT, fal.ai image gen, Magnific upscaling | $0.01–$1 per request |
| **Social** | AgentMail, StableEmail, StablePhone calls | $0.001–$20 per request |

Networks: Base (eip155:84532), Solana, Polygon.

### 11.2 Notable Integrations

- **Coinbase CDP SDK**: Official documentation at `docs.cdp.coinbase.com/x402/welcome`
- **Alchemy Agentic Gateway**: Access blockchain APIs without API keys, pay per request
- **Run402**: AI-native Postgres with x402 auth
- **Dripstack**: Pay-per-Substack-article (agents buy individual posts without subscription)
- **E2B**: Secure cloud sandboxes for AI agents, x402 payment

### 11.3 Agent Ecosystem

The primary consumers of x402 services are AI agents:
- **Agentic Wallet CLI** (`npx skills add coinbase/agentic-wallet-skills`): wallet management for agents
- **Agent frameworks** (LangChain, Vercel AI SDK, etc.): integrate x402 payment into agent tool-use loops
- **Autonomous agents**: discover, evaluate, and purchase services without human intervention

---

## 12. Comparison to Alternatives

### 12.1 L402 / Lightning HTTP 402

| Aspect | L402 | x402 |
|---|---|---|
| Settlement layer | Bitcoin Lightning Network | Base / Solana USDC |
| Payment model | Streaming (per-second micropayments) | Per-request fixed price |
| Token | BTC (volatile) | USDC (stable) |
| Wallet | Lightning wallet | Any EVM wallet (MetaMask, etc.) |
| Adoption | Some API gateways (Lightning Labs) | 1,600+ services on Agentic Market |

### 12.2 Stripe / Traditional Payment Processors

| Aspect | Stripe | x402 |
|---|---|---|
| Setup | Merchant account, KYC, bank account | Just a wallet + middleware |
| Fees | 2.9% + $0.30 | ~$0.00 (gas only) |
| Settlement | 2-7 business days | ~10-30 seconds |
| Chargebacks | Buyer can reverse for 120 days | Irreversible |
| API keys | Required for each user | None (wallet IS identity) |
| Minimum payment | ~$0.50 practical minimum | ~$0.001 (gas-bound) |

### 12.3 API Key / Subscription Model

| Aspect | API Keys | x402 |
|---|---|---|
| User onboarding | Sign up, generate key, manage quota | Just connect wallet |
| Rate limiting | Per-key limits | Natural (pay per use) |
| Overages | Complex billing, invoicing | Impossible (balance-limited) |
| Anonymous usage | No (requires account) | Yes (just a wallet) |
| Server state | Database of keys + users + quotas | Stateless (just middleware) |

---

## 13. Glossary

| Term | Definition |
|---|---|
| **402** | HTTP status code "Payment Required" — the core protocol signal |
| **x402** | The protocol implementing HTTP 402 with crypto settlement |
| **Facilitator** | Component that verifies EIP-712 signatures and settles USDC on-chain. Can run remotely (`HTTPFacilitatorClient`) or in-process (`x402Facilitator` class). The `ExactEvmScheme` contains the actual crypto logic. |
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
| **Facilitator URL** | `https://x402.org/facilitator` — the default remote facilitator. Merchants can also run `x402Facilitator` in-process instead. |
| **SKU / productId** | Individual purchasable item on a merchant's server |
| **Dynamic routes** | Pattern where Bazaar auto-discovers products via `GET /products` |
