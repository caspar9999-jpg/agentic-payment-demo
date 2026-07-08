# Issue 2: Bazaar Discovery + Agent Conversation Engine

**Status**: Implemented (July 2026). MCP replaced by Bazaar discovery layer (`/discovery/resources`). Catalog expanded to 10 products across 3 merchants (coffee, soft drink, water).

## What to build

Expand the MCP Discovery server to a 5-product catalog with per-product merchant wallet registration. Build a new agent engine that implements the conversational decision tree: recommendations, confirmation gates, catalog fallbacks, direct-buy intents, and no-match handling. The agent has zero hardcoded product knowledge and discovers everything via MCP.

Build the MCP client wrapper and write tests for the agent's decision logic.

This slice is verifiable via test file exercising all 6 conversation paths with a mocked MCP client.

## Acceptance criteria

- [x] MCP Discovery catalog expanded to 5 products: Coca-Cola ($1.99), Pepsi ($1.89), Sprite ($1.79), Fanta ($1.69), Dasani ($0.99)
- [x] Each product registered with x402 server using its own merchant wallet address (deterministic from product id)
- [x] Discovery response includes V2-compatible payment details alongside product metadata
- [x] `engine/mcpClient.js` wraps MCP Discovery `/discover` endpoint, returns parsed products with payment details
- [x] `engine/agent.js` implements the decision tree:
  - Specific query (e.g. "cola") → finds match → recommends with confirmation gate ("Want to buy?")
  - "yes" to confirmation → returns payment_card action with product and V2 payment details
  - "no" to confirmation → falls back to catalog listing with a new recommendation
  - Vague query (e.g. "what drinks?") → lists all products + recommends one + confirmation gate
  - No-match query (e.g. "coffee") → "didn't find" message + catalog fallback + recommendation
  - Direct buy intent (e.g. "buy pepsi") → skips confirmation gate, returns payment_card action
- [x] Agent produces structured output: { text, action } where action is one of show_payment_card, show_catalog, confirm_gate
- [x] Tests for `engine/agent.js` covering all 6 conversation paths with mocked MCP client
- [x] Agent never proceeds to payment autonomously — confirmation always required before payment_card action

## Blocked by

- 001-v2-x402-protocol-core (MCP registers products against the V2 x402 server; agent's payment_card action references x402Client structures)
