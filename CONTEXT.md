# Agentic Payment Demo

A demonstration of AI agents discovering paid services via MCP (Model Context Protocol) and completing purchases through the x402 payment protocol (HTTP 402 Payment Required). The agent has zero hardcoded knowledge of available products — it discovers them dynamically via MCP JSON-RPC, and handles payment programmatically with optional real MetaMask signing.

## Language

### Core protocol concepts

**x402 Protocol**:
The open web payment standard built on HTTP 402. A server advertises payment requirements via `PAYMENT-REQUIRED` header, the client signs a cryptographic payment payload and sends it via `PAYMENT-SIGNATURE` header, and the server responds with `PAYMENT-RESPONSE`. All headers are Base64-encoded JSON. Uses V2 header names.
_Avoid_: x402 v1, X-Payment headers, X-Receipt

**MCP (Model Context Protocol)**:
The discovery layer over JSON-RPC 2.0. An MCP marketplace lists available tools via `tools/list`. Agents select a tool and execute it via `tools/call`. In this demo, the `product_discovery` tool queries products with x402 payment details.
_Avoid_: Bazaar (separate concept)

**Vite Proxy**:
A dev-server-level reverse proxy in `vite.config.js` that routes `/x402/*` to the x402 backend (`localhost:3002`) and `/mcp/*` to the MCP backend (`localhost:3001`). Makes all API requests same-origin to the browser, eliminating CORS preflight issues with custom x402 headers.
_Avoid_: Direct origin URLs (`http://localhost:3002`) in browser code

**CAIP-2 Network Identifier**:
Standard format for blockchain network references (e.g. `eip155:84532` for Base Sepolia).
_Avoid_: plain network names

### Domain entities

**Product**:
A purchasable item owned by a Merchant, discoverable via MCP, payable via x402. Has: id, name, description, price, priceInCents, merchantId, merchantName, payTo.

**Merchant**:
The seller of products. Identified by a wallet address (EVM hex string, 0x-prefixed). A merchant owns multiple products and receives payment via their wallet. In the demo, merchants are grouped by wallet address on the x402 server.
_Avoid_: Vendor, seller, service provider

**PaymentPayload**:
JSON object sent in `PAYMENT-SIGNATURE` header (base64). Contains scheme, price, network, payTo, paymentId, sessionId, and optionally signerAddress + signature (when signed via MetaMask).
_Avoid_: Receipt token

**SettlementResponse**:
Server response in `PAYMENT-RESPONSE` header (base64). Contains status, txHash, amount, timestamp, balance. Status: `settled` or `settle_failed`.
_Avoid_: Verification response, receipt

**Demo Wallet**:
Per-session in-memory balance (default $10.00). Deducted on successful settlement. Resettable.

**Merchant Wallet**:
Per-wallet address balance tracking. Multiple products can share one wallet. Visible on the merchant dashboard at `/merchant/:walletAddress`.

**NFT Collectible**:
Generated SVG awarded per purchase with product art, tx hash, and timestamp.

**Purchase History**:
Record of completed purchases. Accessible via inventory panel and `/purchases/:sessionId`.

### Agent behavior

**MCP Discovery Flow**:
1. Agent calls `tools/list` on MCP marketplace → receives available tools
2. Agent selects `product_discovery` tool → calls `tools/call` with user's query
3. Tool returns products with merchant info and x402 payment details
4. Agent processes the response based on intent type

**Confirmation Gate**:
When the agent proactively recommends a product, it asks for confirmation before showing the PaymentCard. Direct purchase requests ("buy coke") skip the gate. The agent never completes payment autonomously.

**x402 Payment Flow**:
1. User clicks Buy Now → frontend does `GET /resource/:productId` → server responds **402** with `PAYMENT-REQUIRED`
2. PaymentCard appears with payment details (network, amount, merchant wallet)
3. User clicks Pay → (if MetaMask connected) `personal_sign` prompt appears with the payment message
4. Signature + payload sent as `PAYMENT-SIGNATURE` → server verifies via `ethers.verifyMessage`
5. Server settles in-memory (debited from demo wallet, credited to merchant wallet)
6. Returns NFT collectible + `PAYMENT-RESPONSE` header

## Relationships

- A **Product** is owned by exactly one **Merchant** (identified by wallet address)
- A **Merchant** may own multiple **Products** (same `payTo` wallet)
- An **Agent** discovers **Products** via **MCP** `tools/list` + `tools/call`
- An **Agent** purchases a **Product** via the **x402 Protocol** (402 → signature → settlement)
- A successful purchase produces one **SettlementResponse** and one **NFT Collectible**
- A **Demo Wallet** holds the user's balance; each purchase debits it
- A **Merchant Wallet** accumulates credits from purchases of that merchant's products

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
frontend/src/
  App.jsx          Orchestrator + all UI components (~680 lines)
  App.css          All styles (~1980 lines)
  sodaEngine.js    x402Client + MCP client + agent engine (~360 lines)
  MerchantPage.jsx Merchant directory + detail pages (~190 lines)
  metamask.js      MetaMask connect/sign utilities (~85 lines)
  main.jsx         Entry point with BrowserRouter routes
```

## Servers

| Server | Port | Endpoints |
|---|---|---|
| x402 | 3002 | `/register`, `/resource/:id`, `/merchants`, `/merchant/:wallet`, `/wallet/:sessionId`, `/purchases/:sessionId` |
| MCP | 3001 | `/mcp` (JSON-RPC: `tools/list`, `tools/call`), `/discover?query=`, `/sse` |
| Vite | 5173 | Frontend dev server with proxy to both backends |

Start order: x402 → MCP (retries until x402 ready) → frontend.

## Routes

| Path | Page |
|---|---|
| `/` | Chat interface |
| `/merchant` | MCP Marketplace directory |
| `/merchant/:walletAddress` | Individual merchant detail page |

## Configuration

Merchant wallets can be overridden via environment variables:
- `MERCHANT_COFFEE` — Coffee Provider wallet
- `MERCHANT_SOFTDRINK` — Soft Drink Provider wallet
- `MERCHANT_WATER` — Water Provider wallet

Defaults are deterministic SHA-256 hashes of `merchant_{id}`.
