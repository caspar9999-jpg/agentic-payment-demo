# Agentic Payment Demo

A demonstration of AI agents discovering paid services via the x402 Bazaar discovery layer and completing purchases through the x402 payment protocol (HTTP 402 Payment Required). The agent discovers products dynamically via `/discovery/resources` and `/discovery/resources/search?q=`, and handles payment programmatically with optional real MetaMask signing.

## Language

### Core protocol concepts

**x402 Protocol**:
The open web payment standard built on HTTP 402. A server advertises payment requirements via `PAYMENT-REQUIRED` header, the client signs a cryptographic payment payload and sends it via `PAYMENT-SIGNATURE` header, and the server responds with `PAYMENT-RESPONSE`. All headers are Base64-encoded JSON. Uses V2 header names (`x402Version`, `accepted` + `payload`). The x402 server delegates verify + settle to a remote facilitator via `HTTPFacilitatorClient` (from `@x402/core/server`). On Base Sepolia, the facilitator settles USDC transfers using EIP-3009 or Permit2.
_Avoid_: x402 v1, X-Payment headers, X-Receipt

**Bazaar Discovery**:
The discovery layer used by agentic.market. Lists available services via `/discovery/resources` and `/discovery/resources/search?q=`. Returns Bazaar-format resources with `type: "http"`, `accepts[]`, and `extensions.bazaar.info`.
_Avoid_: MCP JSON-RPC (deprecated)

**Vite Proxy**:
A dev-server-level reverse proxy in `vite.config.js` that routes `/x402/*` to the x402 backend (`localhost:3002`) and `/bazaar/*` to the Bazaar backend (`localhost:3001`). Makes all API requests same-origin to the browser, eliminating CORS preflight issues with custom x402 headers.
_Avoid_: Direct origin URLs (`http://localhost:3002`) in browser code

**CAIP-2 Network Identifier**:
Standard format for blockchain network references (e.g. `eip155:84532` for Base Sepolia).
_Avoid_: plain network names

### Domain entities

**Product**:
A purchasable item owned by a Merchant, discoverable via Bazaar, payable via x402. Has: id, name, description, price, priceInCents, merchantId, merchantName, payTo.

**Merchant**:
The seller of products. Identified by a wallet address (EVM hex string, 0x-prefixed) and a human-readable name (`"Coffee Provider"`, `"Soft Drink Provider"`, `"Water Provider"`). A merchant owns multiple products and receives payment via their wallet. In the demo, merchants are grouped by wallet address on the x402 server. The merchant detail page supports time-range filtering of revenue/sales.
_Avoid_: Vendor, seller, service provider

**PaymentPayload**:
JSON object sent in `PAYMENT-SIGNATURE` header (base64). V2 format: `{ x402Version, paymentId, accepted: PaymentRequirements, payload, signerAddress?, signature? }`. The `accepted` field identifies which payment option the client selected. The `payload` contains scheme-specific data (e.g., EIP-3009 authorization + signature for the exact scheme).
_Avoid_: Flat key-value payloads without `accepted`

**SettlementResponse**:
Server response in `PAYMENT-RESPONSE` header (base64). V2 format: `{ success, transaction, network, amount?, payer? }`. `success: true` means the facilitator settled on-chain; `transaction` is the real tx hash.
_Avoid_: `status: "settled"`, `txHash`, `balance`

**Wallet Identity**:
No session-based demo wallets. The user's wallet address IS their identity. Settlement goes through the x402 facilitator (on-chain USDC on Base Sepolia). Balance is on-chain, not tracked in-memory.

**Facilitator**:
A remote service (e.g., `https://x402.org/facilitator`) that verifies payment payload signatures and settles USDC transfers on-chain. The x402 server delegates to it via `HTTPFacilitatorClient` (`@x402/core/server`). No in-memory wallet deduction happens on the demo server.

**NFT Collectible**:
Generated SVG awarded per purchase with product art, real tx hash, and purchase ID. Displayed in the payment success view and the Inventory panel. SVGs are auto-sized to fit their container (`max-width: 200px` in chat, `180px` in inventory).

**Purchase History**:
Tracked locally in the frontend after each successful payment. Displayed in two panels:
- **Inventory** — shows purchased items with NFT previews
- **Transactions** — shows timestamp, amount, TX hash, and purchase ID per transaction

**Transaction**:
A single purchase record with: product name, amount, timestamp, settlement transaction hash, purchase ID, and optional NFT data. Viewable in the Transactions sidebar panel.

**Product Icon**:
Emoji mapping per product ID in `App.jsx` (`PRODUCT_ICONS`): espresso/latte/cappuccino → ☕, cold-brew → 🧊, coke/pepsi/sprite → 🥤, fanta → 🍊, dasani/smartwater → 💧, unknown → 📦.

**Payment Summary**:
Shown in the PaymentCard before the user clicks Pay. Includes: item name, price, calories (if applicable), what the user receives (x402 Collectible NFT), network (Base Sepolia), asset (USDC), and pay-to wallet address. An informational note explains the MetaMask flow.

**Time Range Filter**:
A dropdown on merchant pages (directory and detail) to filter revenue/sales by time window: All Time, Last 24 Hours, Last Week, Last Month. Passed as `?rangeHours=24|168|720` to the x402 server.

### Agent behavior

**Bazaar Discovery Flow**:
1. Agent calls `/discovery/resources` on the Bazaar → receives list of available x402 services
2. Each resource includes `type: "http"`, `accepts[]` with payment details (scheme, network, amount, payTo), and `extensions.bazaar.info` with input/output schemas
3. Agent filters/selects a service based on price, description, and user intent
4. Agent calls the resource → gets 402 → pays → gets content

**Scenario-Based Recommendations**:
The agent detects user context from natural language (post-workout, need energy, hot/thirsty, hungry) and scores products against the scenario's needs (hydration, caffeine, electrolytes, calories). The top 3 picks are displayed with reasoning (e.g. "electrolytes for rehydration"). See `PRODUCT_KNOWLEDGE`, `SCENARIOS`, and `getRecommendations()` in `sodaEngine.js`.

**Confirmation Gate**:
When the agent proactively recommends a product, it asks for confirmation before showing the PaymentCard. Direct purchase requests ("buy coke") skip the gate. The agent never completes payment autonomously.

**x402 Payment Flow**:
1. User clicks Buy Now → frontend does `GET /resource/:productId` → server responds **402** with `PAYMENT-REQUIRED` (includes `accepts[]` with `amount`, `asset`, `network`, `payTo`, `maxTimeoutSeconds`, `extra`)
2. PaymentCard appears with payment details (network, amount, merchant wallet) plus a **Payment Summary** section showing item name, price, calories, and what the user receives (NFT)
3. User clicks Pay → (if MetaMask connected) `eth_signTypedData_v4` prompt appears with EIP-712 `TransferWithAuthorization` typed data (switches to Base Sepolia first)
4. The signer verifies the signature client-side and auto-fixes the `v` recovery byte if needed (see Known Issues)
5. Payment payload (V2 format with `accepted` + `payload` + optional `signature`) sent as `PAYMENT-SIGNATURE` header (base64)
6. Server calls `verifyPayment(payload, requirements)` on the facilitator at `https://x402.org/facilitator`
7. If verified, server calls `settlePayment(payload, requirements)` → facilitator settles on Base Sepolia → returns real `transaction` hash
8. Server responds with `PAYMENT-RESPONSE` header (base64) containing `{ success: true, transaction, network }` + product data in body

## Relationships

- A **Product** is owned by exactly one **Merchant** (identified by wallet address)
- A **Merchant** may own multiple **Products** (same `payTo` wallet)
- An **Agent** discovers **Products** via **Bazaar** `/discovery/resources`
- An **Agent** purchases a **Product** via the **x402 Protocol** (402 → facilitator verify → facilitator settle)
- A successful purchase produces one **SettlementResponse** (with real tx hash), one **NFT Collectible**, and one **Transaction** record
- Wallet address IS identity — no session-based demo wallets

## Inventory

### Coffee Provider
- Espresso — $2.99 (5 cal)
- Latte — $3.49 (180 cal)
- Cappuccino — $3.99 (150 cal)
- Cold Brew — $3.29 (10 cal)

### Soft Drink Provider
- Coca-Cola Classic — $1.99 (140 cal)
- Pepsi Cola — $1.89 (150 cal)
- Sprite — $1.79 (140 cal)
- Fanta Orange — $1.69 (160 cal)

### Water Provider
- Dasani Water — $0.99 (0 cal)
- Smartwater — $1.49 (0 cal)

## File Structure

```
x402server/
  app.js                   Express app with hardcoded products, MERCHANT_NAMES map,
                           facilitator integration, time range filtering (?rangeHours=)
  lib/x402facilitator.js   Dead code — HTTPFacilitatorClient wrapper (not imported)
  test/x402server.test.js  Backend tests (14 tests: 402 flow, facilitator, V2 payload)

mcpdiscovery/
  index.js                 Bazaar discovery server: caches x402 /products, serves resources
  test/bazaar.test.js      Bazaar tests (11 tests: resources, search, caching, errors)

frontend/src/
  App.jsx            Chat UI orchestrator + MetaMask panel + sidebar + Transaction panel
  App.css            All styles (payment summary, tx items, merchant range select, NFT sizing)
  sodaEngine.js      x402Client (V2 payloads) + Bazaar client + agent engine
  BazaarDemoPage.jsx Bazaar discovery data flow trace (4-step pipeline)
  MerchantPage.jsx   Merchant directory + detail pages (time range filter, named merchants)
  metamask.js        MetaMask connect/sign utilities
  main.jsx           Entry point with BrowserRouter routes

RUNBOOK.md                Step-by-step demo runbook
```

## Servers

| Server | Port | Endpoints |
|---|---|---|
| x402 | 3002 | `/resource/:id` (protected, 402 flow), `/products`, `/merchants[?rangeHours=]`, `/merchant/:wallet[?rangeHours=]` |
| Bazaar | 3001 | `/discovery/resources`, `/discovery/resources/search?q=` |
| Vite | 5173 | Frontend dev server with proxy to both backends |

Start order: x402 → Bazaar → frontend.

## Routes

| Path | Page |
|---|---|
| `/` | Chat interface |
| `/merchant` | Merchant directory (revenue dashboard, time range filter) |
| `/merchant/:walletAddress` | Individual merchant detail (sales, revenue, purchases, time range filter) |
| `/debug/bazaar` | Bazaar discovery data flow trace (demo-only, hidden from users) |

## Configuration

Merchant wallets can be overridden via environment variables:
- `MERCHANT_COFFEE` — Coffee Provider wallet
- `MERCHANT_SOFTDRINK` — Soft Drink Provider wallet
- `MERCHANT_WATER` — Water Provider wallet

Defaults are deterministic SHA-256 hashes of `merchant_{id}`.

The x402 facilitator URL defaults to `https://x402.org/facilitator` (Base Sepolia testnet). Set `FACILITATOR_URL` to use a different facilitator.

USDC token address on Base Sepolia defaults to `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Set `USDC_ADDRESS` to override.

USDC token name defaults to `"USDC"` (Circle native FiatTokenProxy). Set `USDC_NAME` env var if using a bridged variant that returns a different name (e.g. `"USD Coin"`).

**Facilitator dependency**: The x402 server requires network access to the configured facilitator. If the facilitator is unreachable, `GET /resource/:id` with a valid `PAYMENT-SIGNATURE` will return HTTP 502. The server does not function without the facilitator. Start the x402 server first and verify `/` returns 200 before starting Bazaar or frontend.

## Known Issues

### MetaMask 13.38 Chrome — EIP-712 `v` value bug

MetaMask 13.38.0 on Chrome may return `eth_signTypedData_v4` signatures with an incorrect recovery ID (`v=27` even when `v=28` is correct). The signer in `frontend/src/sodaEngine.js` auto-detects this: it recovers the signer address from the signature, and if it doesn't match the expected account, flips `v` between 27 and 28. The fixed signature is used only if it recovers to the correct address. See `signTypedData` in `frontend/src/sodaEngine.js:31-112`.

Run `testEIP712Signing()` in the browser console or click "Test Signing" in the MetaMask panel to diagnose.
