# ADR 0001: x402 V2 with real SDK middleware (testnet facilitator)

**Status**: Superseded (see ADR 0003)

The demo implements x402 V2 via the official `@x402/express` SDK middleware with a live testnet facilitator (`https://x402.org/facilitator`). Products are declared as route configs in the `paymentMiddleware()` call, not registered at runtime via a REST catalog.

**Why**: The previous hand-rolled implementation (manual header parsing, in-memory wallets, mock tx hashes) was authentic in protocol surface but fake in settlement. Switching to the SDK eliminates that gap — the middleware handles 402 challenges, signature verification, and settlement through the real x402 facilitator. The demo is now settlement-authentic on Base Sepolia.

**Trade-off**: The SDK requires a live facilitator connection. If the facilitator is unreachable, the server returns 502 errors. We accept this because the demo's credibility depends on real protocol behavior.

**What changed**:
- `POST /register` removed; products are hardcoded in `app.js` (will be route configs when `@x402/express` middleware lands in Fix #11)
- Manual header handling removed; facilitator (via `@x402/core/server` `HTTPFacilitatorClient`) manages verify + settle
- Settlement goes through `x402.org/facilitator` (testnet) instead of in-memory wallet deduction
- `GET /products` still returns product catalog (hardcoded product definitions)
- `@x402/evm` provides `ExactEvmScheme` for Base Sepolia (client-side signing via MetaMask)
- `lib/x402facilitator.js` wraps `HTTPFacilitatorClient` for verify/settle/getSupported
- In-memory `userWallets` (`DEFAULT_BALANCE_CENTS`, `getUserWallet`, `generateTxHash`) removed
- `/wallet/:sessionId`, `/wallet/:sessionId/reset`, `/purchases/:sessionId` removed (wallet = address, no sessions)
- Frontend `x402Client` updated: `getBalance`, `resetWallet`, `getPurchases` removed; `payForResource` uses V2 `accepted` + `payload` format
