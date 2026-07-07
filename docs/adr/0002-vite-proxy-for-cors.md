# ADR 0002: Vite dev server proxy to eliminate CORS

The frontend (Vite dev server on port 5173) makes requests to two different origins: x402 server (port 3002) and MCP Discovery server (port 3001). Browsers enforce CORS on cross-origin requests.

**Why**: The x402 protocol uses custom HTTP headers (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`). The second request in the payment flow (`PAYMENT-SIGNATURE`) triggers a CORS preflight (OPTIONS). Despite correctly configuring `Access-Control-Expose-Headers` and `Access-Control-Allow-Headers` on the x402 server, the `PAYMENT-REQUIRED` header remained unreadable from JavaScript in practice — likely due to browser caching of preflight responses or middleware ordering edge cases in the `cors` npm package.

**Considered**:
1. **CORS-only** — Rely solely on `Access-Control-Allow-Origin` + `exposedHeaders`. Rejected: brittle, browser-dependent, and the preflight cache makes debugging unreliable.
2. **Vite proxy** — Proxy `/x402/*` → `localhost:3002` and `/mcp/*` → `localhost:3001` through the Vite dev server. All requests appear same-origin to the browser. No CORS at all. Chosen.
3. **Production build on same port** — Serve frontend and backends behind a single reverse proxy. Over-engineered for a local demo.

**Trade-off**: The proxy only works during `vite dev` / `npm run dev`. Production builds (`vite build` + `vite preview`) would need a separate reverse proxy (e.g. nginx) or the CORS headers as fallback. We keep the CORS config on the x402 server as a safety net.

**Decision**: Use Vite `server.proxy` to route `/x402` → x402 server and `/mcp` → MCP server. Frontend code uses relative paths (`/x402/resource/coke` instead of `http://localhost:3002/resource/coke`).
