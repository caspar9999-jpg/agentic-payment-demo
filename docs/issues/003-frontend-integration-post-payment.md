# Issue 3: Frontend Integration + Post-Payment UI

**Status**: Implemented (July 2026). Added merchant pages (`/merchant`, `/merchant/:wallet`), Bazaar demo page (`/debug/bazaar`), MetaMask signing, inventory panel, and purchase tracking with real tx hashes.

## What to build

Reorganize the frontend file structure, wire the new engine modules to the chat UI, and build the post-payment experience. This includes extracting components from App.jsx, integrating the agent conversation engine, adding purchase history and merchant revenue panels, and handling payment failures with wallet reset.

This slice is verified by running the full app and walking through all conversation paths, completing a purchase, and checking the inventory and merchant panels.

## Acceptance criteria

- [x] File structure reorganized: `engine/` (agent.js, x402Client.js, mcpClient.js), `components/` (all UI components), `wallet/` (metamask.js), `utils/` (nft.js)
- [x] Existing components extracted from App.jsx: ChatMessage, PaymentCard, WalletPanel, MetaMaskPanel, MCPPanel
- [x] App.jsx becomes thin orchestrator — imports from engine/ and components/
- [x] Agent conversation engine wired to chat: user messages flow through agent, agent's action determines what's rendered (payment card, catalog list, confirmation prompt)
- [x] User can confirm ("yes") or reject ("no") the agent's recommendation, with appropriate UI response for each path
- [x] Payment card shows V2 payment details (network, amount, payTo address) from the x402Client
- [x] Pay button triggers V2 flow via x402Client → shows NFT collectible on success
- [x] `InventoryPanel.jsx` — sidebar panel showing purchase history: product name, price, tx hash, timestamp, NFT preview
- [x] `MerchantPanel.jsx` — sidebar toggle showing merchant wallet balances and cumulative revenue
- [x] MetaMask integration reduced to optional badge (connect/disconnect, no real transaction signing)
- [x] Payment failure shows error message in chat with wallet reset button
- [x] Wallet reset button restores demo balance to $10.00 and clears purchase history
- [x] Demo wallet balance visible in sidebar and updates after purchases
- [x] All CSS styles for new components (inventory, merchant, NFT cards, conversation states)
- [x] CORS elimination via Vite dev server proxy: `/x402` → x402 server, `/mcp` → MCP server

## Bugfix: Payment failed due to unreadable PAYMENT-REQUIRED header

**Root cause**: The second fetch in `payForResource()` sends a custom `PAYMENT-SIGNATURE` header, triggering a CORS preflight. The preflight response's `Access-Control-Allow-Headers` didn't include `PAYMENT-SIGNATURE` (or the browser cached a stale preflight), causing the fetch to fail. The `accessResource()` function's `headers.get("PAYMENT-REQUIRED")` returned `null`, and `errorMessage()` fell through to the generic `"Payment failed"` string — masking the actual CORS error.

**Fix**: Configure Vite `server.proxy` to route `/x402/*` → `localhost:3002` and `/mcp/*` → `localhost:3001`. All requests now appear same-origin to the browser, eliminating the need for CORS entirely. The x402 server's `cors` config is kept as a fallback for production/preview builds.

**Files changed**:
- `frontend/vite.config.js` — added `server.proxy` block
- `frontend/src/engine/x402Client.js` — `X402_BASE` from `http://localhost:3002` → `/x402`
- `frontend/src/engine/mcpClient.js` — `MCP_BASE` from `http://localhost:3001` → `/mcp`
- `frontend/tests/x402Client.test.js` — test URL constant updated
- `x402server/index.js` — hardened CORS with explicit `origin`, `methods`, `exposedHeaders`

## Blocked by

- 001-v2-x402-protocol-core (UI depends on V2 x402Client and server)
- 002-mcp-discovery-agent-engine (UI depends on agent engine for conversation logic)
