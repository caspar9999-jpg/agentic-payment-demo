# Agentic Payment Demo

A demonstration of AI agents discovering paid services via MCP (Model Context Protocol) and completing purchases through the x402 payment protocol (HTTP 402 Payment Required). The agent has zero hardcoded knowledge of available products — it discovers them dynamically and handles payment programmatically.

## Language

### Core protocol concepts

**x402 Protocol**:
The open web payment standard built on HTTP 402. A server advertises payment requirements, the client signs a cryptographic payment payload, and settlement occurs via a facilitator. Uses V2 headers: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` (all Base64-encoded JSON).
_Avoid_: x402 v1, X-Payment headers, X-Receipt

**MCP (Model Context Protocol)**:
The discovery layer. An MCP server advertises available tools (e.g. `product_discovery`) that agents use to find what exists. Agents call MCP to discover services before attempting payment.
_Avoid_: Bazaar (separate concept — MCP is the discovery mechanism here)

**Facilitator**:
In production x402, an external service that verifies and settles blockchain payments on behalf of the server. In this demo, the facilitator role is combined with the x402 payment server since no real blockchain is used.
_Avoid_: Proxy, payment gateway

**Vite Proxy**:
A dev-server-level reverse proxy in `vite.config.js` that routes `/x402/*` to the x402 backend (`localhost:3002`) and `/mcp/*` to the MCP backend (`localhost:3001`). Makes all API requests same-origin to the browser, eliminating CORS preflight issues with custom x402 headers. The proxy is active only during `npm run dev`; production/preview builds fall back to the CORS headers on the x402 server.
_Avoid_: Direct origin URLs (`http://localhost:3002`) in browser code

**CAIP-2 Network Identifier**:
Standard format for blockchain network references (e.g. `eip155:84532` for Base Sepolia). Replaces informal names like `"base-sepolia"`.
_Avoid_: plain network names

### Domain entities

**Product**:
A purchasable item in the catalog. Owned by a Merchant, discoverable via MCP Discovery, payable via x402. Has: id, name, description, price (USD string), priceInCents (integer).

**Merchant**:
The seller of a product. Identified by a wallet address (hex string for EVM). Each product maps to exactly one merchant. A merchant receives payment when their product is purchased.
_Avoid_: Vendor, seller, provider, service provider

**PaymentPayload**:
The client-side object signed by the user's wallet, containing the selected payment option, amount, and destination. Sent in the `PAYMENT-SIGNATURE` header (base64-encoded). In demo mode, uses a session-based mock signature.
_Avoid_: Receipt token, payment proof

**SettlementResponse**:
The server-side response confirming payment outcome. Sent in the `PAYMENT-RESPONSE` header (base64-encoded). Contains: status, txHash, amount, timestamp. Replaces the old receipt token concept.
_Avoid_: Verification response, receipt

**Demo Wallet**:
Per-session in-memory balance (default $10.00) simulating the user's spending power. Deducted on successful settlement. Resettable for demo purposes.
_Avoid_: Test wallet, session balance

**Merchant Wallet**:
Per-product wallet address and balance tracking. Receives funds when a product is purchased. Visible in the merchant panel.

**NFT Collectible**:
A generated SVG digital collectible awarded to the user upon successful purchase. Each purchase produces a unique NFT with product art, tx hash, and timestamp.

**Purchase History**:
The user's record of completed purchases, stored as SettlementResponse objects. Accessible via inventory panel and `/purchases/:sessionId` endpoint.

### Agent behavior

**Confirmation Gate**:
When the agent proactively recommends a product (after a vague or indirect query), it asks the user to confirm before showing the payment card. When the user makes an explicit purchase request ("buy coke", "I want a cola"), the confirmation gate is skipped and the payment card is shown directly. The agent never completes a payment autonomously — the user must always click the pay button.
_Avoid_: Auto-pay, auto-purchase

**Catalog Fallback**:
When the user rejects a recommendation, the agent falls back to listing all available products. Also triggered when no products match the user's query.

**Recommendation**:
The agent selects one product to highlight based on query relevance. If the user's query is vague, the agent recommends the first match from the catalog.

## Relationships

- A **Product** is owned by exactly one **Merchant**
- A **Merchant** may own multiple **Products**
- An **Agent** discovers **Products** via **MCP** Discovery
- An **Agent** purchases a **Product** via the **x402 Protocol**
- A successful purchase produces one **SettlementResponse** and one **NFT Collectible**
- A **Demo Wallet** holds the user's balance; each purchase debits it
- A **Merchant Wallet** accumulates credits from purchases of that merchant's products

## Inventory

- **Coca-Cola Classic** — $1.99 — coke merchant
- **Pepsi Cola** — $1.89 — pepsi merchant
- **Sprite** — $1.79 — sprite merchant
- **Fanta Orange** — $1.69 — fanta merchant
- **Dasani Water** — $0.99 — dasani merchant

## Example dialogue

> **Dev:** "When the user says 'yes' to the agent's recommendation, what does the frontend send?"
> **Domain expert:** "It creates a mock PaymentPayload and re-requests the resource endpoint with PAYMENT-SIGNATURE. The server verifies the demo wallet balance, settles the payment, and returns the NFT collectible with a PAYMENT-RESPONSE header."
>
> **Dev:** "What if the user says 'no' instead?"
> **Domain expert:** "The agent falls back to the catalog fallback — lists all available products and asks which one they want."
>
> **Dev:** "And if the wallet has insufficient balance?"
> **Domain expert:** "The server returns a 402 with a settlement-failed PAYMENT-RESPONSE. The frontend shows the failure and offers a wallet reset."
