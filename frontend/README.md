# Agentic Payment Demo — Frontend

React + Vite frontend for the x402 agentic payment demo.

## Pages

| Route | Component | Description |
|---|---|---|
| `/` | `App.jsx` | Chat interface — agent discovers via Bazaar, pays via x402 |
| `/merchant` | `MerchantPage.jsx` | Merchant directory with revenue dashboard |
| `/merchant/:wallet` | `MerchantPage.jsx` | Individual merchant detail (sales, revenue, purchases) |
| `/debug/bazaar` | `BazaarDemoPage.jsx` | Bazaar discovery data flow trace (demo-only) |

## Architecture

- **`sodaEngine.js`** — x402 client, Bazaar client, agent intent engine
- **`metamask.js`** — MetaMask connect/disconnect/signing utilities
- **`App.css`** — Single stylesheet for all components and pages

## Proxy

Vite dev server proxies API calls to avoid CORS:

| Prefix | Target |
|---|---|
| `/x402/*` | `http://localhost:3002` |
| `/bazaar/*` | `http://localhost:3001` |

## Running

```bash
npm install
npm run dev      # Dev server at localhost:5173
npm test         # 31 tests (8 x402 client + 23 agent)
npm run build    # Production build
```

Requires `x402server` (:3002) and `mcpdiscovery` (:3001) running first.
