# Issue 1: V2 x402 Protocol Core

**Status**: Implemented (July 2026). Settlement uses real `@x402/express` SDK middleware with live testnet facilitator, not mocked/demo wallets.

## What to build

Rewrite the x402 server to the V2 protocol surface and build a matching x402 client library. The settlement flow becomes: client requests resource → gets 402 with `PAYMENT-REQUIRED` header → client re-requests with `PAYMENT-SIGNATURE` header → server verifies demo balance, deducts user wallet, credits merchant wallet, generates mock tx hash → returns resource body + `PAYMENT-RESPONSE` header.

Also build the SVG NFT generator as a pure utility function.

This slice is verifiable via curl/script showing the complete V2 flow end-to-end.

## Acceptance criteria

- [x] x402 server uses V2 headers: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` (all base64-encoded JSON)
- [x] 402 response uses `accepts[{scheme, price, network, payTo}]` schema with CAIP-2 networks (e.g. `eip155:84532`)
- [x] Products register with individual merchant wallet addresses
- [x] Server tracks per-session demo wallets (default $10.00) and per-merchant wallet balances
- [x] Settlement happens in a single request-response cycle: verify demo balance → deduct → credit merchant → generate mock tx hash → return resource
- [x] `GET /purchases/:sessionId` returns purchase history as SettlementResponse objects
- [x] `GET /merchant/:walletAddress` returns merchant wallet balance and revenue
- [x] `engine/x402Client.js` encapsulates all V2 protocol interactions: accessResource, createPaymentPayload, parsePaymentResponse, getBalance, resetWallet, getPurchases, getMerchantBalances
- [x] PAYMENT-SIGNATURE header is correctly base64-encoded when submitting payment
- [x] PAYMENT-RESPONSE header is correctly parsed on both success and failure responses
- [x] `utils/nft.js` generates a unique SVG collectible for each purchase (product name, price, tx hash, timestamp)
- [x] Tests for `engine/x402Client.js` covering: 402 handling, PaymentPayload creation, header encoding, success/failure PAYMENT-RESPONSE parsing, balance/ wallet/ purchase/ merchant operations
- [x] Insufficient balance returns settlement-failed PAYMENT-RESPONSE with shortfall information

## Blocked by

None — can start immediately.
