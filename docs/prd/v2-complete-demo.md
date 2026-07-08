# PRD: v2 Complete Demo

**Status**: Implemented (July 2026) — see RUNBOOK.md for current usage.

> **Implementation note**: The PRD originally specified mocked settlement and in-memory demo wallets. The implemented version uses **real x402 SDK middleware** (`@x402/express`) with a live testnet facilitator (`https://x402.org/facilitator`) on Base Sepolia. Sessions and in-memory balances were removed — the user's MetaMask wallet is identity. Bazaar discovery replaced MCP as the discovery layer per agentic.market conventions. The 5-product catalog was expanded to 10 products across 3 merchants (coffee, soft drink, water).

## Problem Statement

The current demo is a proof-of-concept with only the happy path: user asks for a drink, the agent recommends one, and the user pays via MetaMask. It has three critical gaps:

1. **x402 protocol is incorrect.** The demo uses custom V1-style headers (`X-Payment`, `X-Receipt`), custom receipt tokens, plain-text fields, and informal network names (`"base-sepolia"`). The x402 protocol has moved to V2 with standardized `PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE`/`PAYMENT-RESPONSE` headers (base64-encoded JSON), CAIP-2 network identifiers, and a settlement-first payment flow.

2. **Only one conversational path.** The agent always recommends a product and shows a payment card. There is no confirmation step, no catalog browsing, no fallback for unknown queries, and no way for the user to choose a different product.

3. **No post-payment experience.** After payment, the user sees a receipt token but nothing else — no collectible, no purchase history, no merchant-side view of revenue. The demo ends at "resource access granted" with no meaningful deliverable.

## Solution

Rebuild the demo around the x402 V2 protocol surface while keeping all settlement mocked (no real blockchain). Expand the agent to handle multiple conversational paths with a confirmation gate. Add a post-payment experience: generated SVG NFT collectibles, purchase history, and a merchant revenue panel.

The demo should still be a single-page app with three backend services (frontend + MCP Discovery + x402 server), all runnable locally with zero external dependencies beyond npm packages.

## User Stories

### Agent conversation flows

1. As a user asking for a specific drink ("I want a coke"), the agent should find the matching product via MCP Discovery, recommend it with price details, and ask me to confirm before showing payment — so I'm not forced into a purchase automatically.

2. As a user who says "yes" to the agent's recommendation, I should see a payment card with the x402 V2 payment details (network, amount, payTo address) and a pay button — so I can complete the purchase.

3. As a user who says "no" to the recommendation, the agent should fall back to listing all available products — so I can choose something else.

4. As a user asking a vague question ("what drinks do you have?"), the agent should list all discovered products and recommend one — so I can see the full catalog and get a suggestion.

5. As a user asking for something not in the catalog ("do you have coffee?"), the agent should tell me nothing was found and then show the full catalog with a recommendation — so I know what IS available.

6. As a user saying "buy pepsi" directly, the agent should skip the confirmation gate and show the payment card immediately — so power users aren't slowed down.

### x402 V2 protocol

7. As a frontend client accessing a resource without payment, I should receive an HTTP 402 with a `PAYMENT-REQUIRED` header containing a base64-encoded V2 PaymentRequired object with an `accepts` array — so the response follows the V2 protocol spec.

8. As a frontend client submitting payment, I should send a `PAYMENT-SIGNATURE` header with a base64-encoded PaymentPayload, and receive a `PAYMENT-RESPONSE` header with a base64-encoded SettlementResponse — so the full V2 header contract is respected.

9. As a developer reading the protocol surface, I should see CAIP-2 network identifiers (e.g. `eip155:84532`) and the `accepts[{scheme, price, network, payTo}]` schema — so the demo looks correct to anyone familiar with x402.

10. As the x402 server, I should manage per-session demo wallets (default $10.00) and deduct balances during settlement — so payments are simulated but the balance system works.

11. As the x402 server, I should track per-merchant wallet balances that accumulate when products are purchased — so the merchant side has visible revenue.

12. As the x402 server, I should handle the settlement in a single request-response cycle (verify + settle + return resource in one call) — so the demo remains simple while mimicking the facilitator flow.

### Payment and post-payment

13. As a user who just completed a purchase, I should receive a generated SVG NFT collectible specific to that product and transaction — so I have a digital token proving my purchase.

14. As a user, I should see a purchase history panel in the sidebar listing all my completed purchases with product name, price, tx hash, and timestamp — so I can review what I've bought.

15. As a user whose wallet runs out of funds, I should see a clear payment failure message and an option to reset my wallet — so I can continue using the demo.

16. As a demo viewer interested in the merchant side, I should be able to toggle to a merchant panel showing cumulative revenue per merchant wallet — so I can see both sides of the payment flow.

### Discovery

17. As an agent calling MCP Discovery, I should receive products with V2-compatible payment details (accepts array with scheme, price, CAIP-2 network, payTo) alongside the existing product metadata — so the discovery response is protocol-consistent.

18. As a demo viewer, I should see 5 products in the catalog (Coca-Cola, Pepsi, Sprite, Fanta, Dasani) — so the browsing and fallback flows have meaningful variety.

### Wallet

19. As a user, I should see my demo wallet balance in the sidebar — so I know how much I can spend.

20. As a user, I should have the option to connect MetaMask (optional badge, no real tx) — so the wallet concept is communicated without requiring real signing.

## Implementation Decisions

### Modules

**New modules:**

- **`engine/agent.js`** — Mock LLM with decision-tree logic. Pure function: input is user message plus conversation state, output is response text plus action type (show_payment_card, show_catalog, confirm_gate). Zero hardcoded product knowledge — calls MCP Discovery for all product data. Testable in isolation with no DOM or network dependencies.

- **`engine/x402Client.js`** — V2 protocol client. Encapsulates: accessing resources (handling 402), creating mock PaymentPayloads, re-requesting with `PAYMENT-SIGNATURE` header, parsing `PAYMENT-RESPONSE`. Also: getBalance, resetWallet, getPurchases, getMerchantBalances. All fetch calls parameterized for testability.

- **`engine/mcpClient.js`** — Thin wrapper around MCP Discovery REST endpoint. Calls `/discover` with query, returns parsed product array with V2 payment details.

- **`utils/nft.js`** — Pure SVG generation. Inputs: product name, price, tx hash, timestamp. Output: SVG string. No dependencies, trivially testable.

- **`components/InventoryPanel.jsx`** — Purchase history sidebar component. Shows purchased products as NFT cards with tx hash and timestamp.

- **`components/MerchantPanel.jsx`** — Merchant view: lists merchant wallets and their current balances. Toggleable via sidebar.

**Modified modules:**

- **`x402server/index.js`** — Full V2 protocol rewrite. Changes:
  - Headers: `PAYMENT-REQUIRED` (outbound 402), `PAYMENT-SIGNATURE` (inbound), `PAYMENT-RESPONSE` (outbound 200/402), all base64-encoded JSON
  - Schema: `accepts[{scheme, price, network, payTo}]` in PaymentRequired
  - Networks: CAIP-2 format (`eip155:84532`)
  - Flow: Access resource → 402 → re-submit with PAYMENT-SIGNATURE → verify demo balance → deduct + credit merchant → generate mock tx hash → return resource + PAYMENT-RESPONSE
  - New endpoints: `GET /purchases/:sessionId`, `GET /merchant/:walletAddress`
  - Merchant wallet tracking: separate balance Map keyed by wallet address
  - Products registered with distinct merchant wallet addresses

- **`frontend/vite.config.js`** — Vite dev server proxies API calls to avoid CORS:
  - Proxy `/x402/*` → `http://localhost:3002` (x402 server)
  - Proxy `/mcp/*` → `http://localhost:3001` (MCP server)
  - Frontend code uses relative paths (`/x402/resource/coke`) instead of full origins
  - Eliminates all CORS preflight issues with custom headers (`PAYMENT-SIGNATURE`)
  - See ADR 0002 for rationale

- **`mcpdiscovery/index.js`** — Enriched registration and discovery:
  - 5-product catalog (coke, pepsi, sprite, fanta, dasani)
  - Each product registered with its own merchant wallet address
  - Discovery response includes V2-compatible payment details
  - Registers products with the x402 server on startup

- **`frontend/src/App.jsx`** — Refactored to thin orchestrator. Imports from engine/ and components/. Manages conversation state (confirmation gate), payment state, and panel visibility.

- **`frontend/src/App.css`** — New styles for InventoryPanel, MerchantPanel, NFT cards.

**Component extraction from App.jsx:**
- ChatMessage, PaymentCard, WalletPanel, MetaMaskPanel, MCPPanel — moved to `components/`
- `metamask.js` — moved to `wallet/metamask.js`

### Conversation action model

The agent is a pure function: given a user message and optional conversation context, it returns a structured output with an action type that determines what the UI renders. There is no formal state machine — conversation flow is driven by action types and a minimal context object.

**Agent output**: `{action, text, product, products}` where `action` is one of:

| Action | What the UI renders | Triggered by |
|---|---|---|
| `confirm_gate` | Confirm/no buttons with a recommended product | Specific query (`"cola"`), after "no" rejection |
| `show_payment_card` | PaymentCard component (pay button + NFT) | `"yes"` to confirm_gate, direct buy (`"buy coke"`), explicit request (`"I want a cola"`), catalog item click |
| `show_catalog` | Product list + recommended product with confirm/no buttons | Vague query (`"what drinks?"`), no-match fallback, "no" rejection |

**Context** (`{lastAction, lastProduct}`) is minimal — used only to detect when "yes"/"no" is a response to a prior `confirm_gate`. All other paths reset context.

**Direct buy** (`"buy coke"`, `"get a pepsi"`, `"I want a cola"`) skips the confirmation gate and returns `show_payment_card` immediately. Explicit requests from the user count as sufficient intent.

**Catalog item click** — each product in a catalog listing is a clickable button that directly triggers `show_payment_card` for that product, bypassing the confirmation gate.

**No-results query** → agent informs user no match found, falls back to `show_catalog` with all products and a recommendation.

### V2 protocol settlement flow (mocked)

```
Client                            Server
  |  GET /resource/coke             |
  | ------------------------------->|
  |  402 + PAYMENT-REQUIRED header  |
  | <-------------------------------|
  |                                 |
  |  GET /resource/coke             |
  |  + PAYMENT-SIGNATURE header     |
  | ------------------------------->|
  |                                 | verify demo balance
  |                                 | deduct user wallet
  |                                 | credit merchant wallet
  |                                 | generate mock tx hash
  |                                 | build NFT SVG
  |  200 + PAYMENT-RESPONSE header  |
  |  + NFT resource body            |
  | <-------------------------------|
```

No separate `/verify` or `/settle` endpoints needed in the demo — the server handles both roles internally in a single request cycle.

### Product catalog

| Product | Price | Merchant Wallet |
|---|---|---|
| Coca-Cola Classic | $1.99 | Generated hex address |
| Pepsi Cola | $1.89 | Generated hex address |
| Sprite | $1.79 | Generated hex address |
| Fanta Orange | $1.69 | Generated hex address |
| Dasani Water | $0.99 | Generated hex address |

Each merchant wallet is a deterministic hex address derived from the product id (for consistency across restarts).

## Testing Decisions

Tests will be written for two deep modules:

### `engine/agent.js`

- **What makes a good test**: Only test external behavior — given a user message and conversation state, what action and response text does the agent produce? Never test internal implementation details like which response template was chosen.
- **Test scenarios**:
  - Specific query results in recommendation with confirmation gate
  - "yes" confirmation returns payment card action
  - "no" confirmation falls back to catalog listing
  - Vague query lists all products with recommendation
  - No-match query returns not-found message with catalog fallback
  - Direct buy intent ("buy X") skips confirmation
  - Unknown message type returns a sensible default
- **Test approach**: The agent depends on MCP client. Inject a mock MCP client that returns a known set of products. Assert on the returned action type and key text content.

### `engine/x402Client.js`

- **What makes a good test**: Test protocol behavior — does the client correctly handle 402 responses, create properly structured PaymentPayloads, encode headers in base64, parse PAYMENT-RESPONSE, and handle errors? Mock fetch, don't mock the client.
- **Test scenarios**:
  - Accessing a resource without payment returns payment_required with parsed PaymentRequired
  - Accessing an already-paid resource returns the resource body
  - Creating a PaymentPayload matches the accepted option from PaymentRequired
  - PAYMENT-SIGNATURE header is correctly base64-encoded
  - PAYMENT-RESPONSE is correctly parsed on success
  - Insufficient balance returns an error with shortfall info
  - getBalance returns wallet info
  - resetWallet resets to default balance
  - getPurchases returns purchase history
- **Test approach**: Mock the global fetch to return controlled x402 responses. Assert on the structured output of each client method.

## Out of Scope

- Real blockchain transactions or on-chain settlement
- Real cryptographic wallet signing (MetaMask is display-only)
- External facilitator integration
- Budget & governance checks (Step 3 from Flow_Overview.mermaid)
- Agent synthesis and report generation (Step 6 from Flow_Overview.mermaid)
- Audit trail/audit logging
- Amazon Web Services (Bedrock, runtime, gateway)
- Multi-item orders (buying coke AND pepsi in one flow)
- Product detail inquiry ("tell me more about coke")
- Rejection loops beyond one "no" → catalog fallback
- Real merchant registration or external service discovery
- Bazaar integration
- Mobile/responsive design improvements
- Accessibility work

## Further Notes

- The project has CONTEXT.md for domain vocabulary and two ADRs: 0001 (V2 compliance) and 0002 (Vite proxy for CORS). All terms used in this PRD follow the CONTEXT.md glossary.
- The CORS bug (payment always failed) was resolved by routing backend requests through the Vite dev server proxy (`/x402` → x402, `/mcp` → MCP), eliminating cross-origin issues entirely. See ADR 0002.
- The agent never proceeds with payment autonomously — the confirmation gate ensures the user always has control, which is documented as a deliberate demo constraint.
