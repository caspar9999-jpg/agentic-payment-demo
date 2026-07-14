# Agentic Payment Demo — Frontend

React + Vite frontend for the x402 agentic payment demo.

## Pages

| Route | Component | Description |
|---|---|---|
| `/` | `App.jsx` | Chat interface — agent discovers via Bazaar, pays via x402. Sidebar has Chat, Inventory, and Transactions panels. PaymentCard shows detailed Payment Summary before signing. |
| `/merchant` | `MerchantPage.jsx` | Merchant directory with revenue dashboard. Shows named merchants (Coffee Provider, Soft Drink Provider, Water Provider) with Revenue labels. Supports time range filter (All Time / 24h / Week / Month). |
| `/merchant/:wallet` | `MerchantPage.jsx` | Individual merchant detail (sales, revenue, purchases) with time range filter. |
| `/debug/bazaar` | `BazaarDemoPage.jsx` | Bazaar discovery data flow trace (demo-only). |

## Architecture

- **`sodaEngine.js`** — x402 client (V2 payloads), Bazaar client, agent intent engine. `getMerchantBalances(rangeHours)` and `getMerchant(merchantId, rangeHours)` accept optional time range.
- **`metamask.js`** — MetaMask connect/disconnect/signing utilities.
- **`App.css`** — Single stylesheet for all components. Includes styles for: payment summary box, transaction items, time range select, merchant revenue labels, NFT auto-sizing, product icons.
- **`App.jsx`** — `PRODUCT_ICONS` map for emoji per product. `PaymentCard` with detailed Payment Summary (item, price, calories, what you receive, network, asset, pay-to). `TransactionsPanel` showing timestamp, amount, TX hash, purchase ID. `InventoryPanel` with NFT previews.

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
