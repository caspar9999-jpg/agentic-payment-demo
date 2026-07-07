# ADR 0001: x402 V2 protocol compliance with mock settlement

The demo implements the x402 V2 protocol surface (headers, schemas, CAIP-2 networks, base64 encoding, settlement-before-delivery flow) but uses mock wallets and simulated blockchain settlement instead of real on-chain transactions and external facilitators.

**Why**: The x402 V1-style implementation (custom X-Payment headers, receipt tokens, reverse-order settlement) was not representative of the current protocol. V2 compliance makes the demo credible to anyone familiar with x402 while keeping it self-contained and runnable without testnet tokens or external services.

**Trade-off**: Full V2 compliance requires base64-encoded JSON payloads and precise CAIP-2 network formatting, adding complexity over simpler plain-text headers. We chose compliance because the protocol surface IS the thing we're demonstrating — a correct-but-simple demo is more valuable than an incorrect-but-simpler one.

**Considered**: Loose V2-inspired headers without base64 encoding or CAIP-2. Rejected: wouldn't survive scrutiny from anyone who knows the protocol.
