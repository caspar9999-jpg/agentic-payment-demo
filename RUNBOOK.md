# x402 Agentic Payment Demo — Runbook

## Overview

A local demo of AI agents discovering paid services via the x402 Bazaar discovery layer and completing payments through the x402 protocol (HTTP 402 Payment Required).

**3 servers, 1 frontend:**

| Server | Port | Purpose |
|---|---|---|
| x402server | 3002 | Product catalog + x402 payment flow |
| mcpdiscovery | 3001 | Bazaar discovery layer |
| Frontend (Vite) | 5173 | Chat UI + demo pages |

**4 demo pages:**

| Route | Purpose | User-facing? |
|---|---|---|
| `/` | Chat interface — agent discovers & pays | Yes |
| `/merchant` | Merchant directory + revenue dashboard | Yes |
| `/merchant/:wallet` | Individual merchant detail | Yes |
| `/debug/bazaar` | Bazaar discovery data flow trace | Demo only (🔬 icon) |

---

## Prerequisites

- **Node.js** v18+
- **MetaMask** browser extension
- **Base Sepolia** testnet added to MetaMask
- **Testnet USDC** on Base Sepolia (faucet.circle.com)
- **Testnet ETH** on Base Sepolia for gas (alchemy.com/faucets/base-sepolia)

---

## Step 1 — Install Dependencies

Open PowerShell and navigate to the project root first:

```powershell
cd "C:\Projects\Agentic_Payment_Demo\agenticpayment (1)\agenticpayment"
```

Then install each service (run these one at a time):

```powershell
cd x402server; npm install; cd ..
cd mcpdiscovery; npm install; cd ..
cd frontend; npm install; cd ..
```

---

## Step 2 — Start All Servers

**Order matters:** x402 first (Bazaar queries it), then Bazaar, then frontend.

### Option A: Manual (3 terminals, PowerShell)

Start three separate PowerShell windows, each from the project root first:

```powershell
cd "C:\Projects\Agentic_Payment_Demo\agenticpayment (1)\agenticpayment"
```

**Terminal 1 — x402 Payment Server:**
```powershell
cd x402server; node index.js
```
Verify: `curl http://localhost:3002/` → `{"name":"x402-payment-server","status":"running"}`

**Terminal 2 — Bazaar Discovery:**
```powershell
cd mcpdiscovery; node index.js
```
Verify: `curl http://localhost:3001/discovery/resources` → `{"resources":[...]}`

**Terminal 3 — Frontend:**
```powershell
cd frontend; npm run dev
```
Verify: Open `http://localhost:5173`

### Option B: Single command (bash/Git Bash only)

```bash
bash start-all.sh
```

---

## Step 3 — Run the Demo

### Flow 1: Intelligent scenario-based recommendations + payment

Agent understands context and recommends drinks based on your needs:

1. Open `http://localhost:5173`
2. Connect MetaMask (left sidebar) — will prompt to switch to Base Sepolia
3. Type something contextual like:
   - *"I just finished a workout, what should I drink?"*
   - *"I need an energy boost, I'm tired"*
   - *"It's so hot today, anything refreshing?"*
   - *"I'm hungry, what do you have?"*
4. Agent detects the scenario (post-sport / need energy / hot & thirsty / hungry), scores all products against your needs, and shows top picks **with reasoning** (e.g. "Smartwater — electrolytes for rehydration")
5. Browse recommendations, then click **Buy Now** to purchase, or pick any product from the catalog
6. **Payment summary** appears in the chat — shows item name, price, calories, what you receive (NFT), network, asset, and pay-to wallet
7. Click Pay → MetaMask prompts for EIP-712 signature → sign
8. Settlement via facilitator on Base Sepolia — NFT collectible awarded

### Flow 2: Direct purchase (quick path)

1. Type: *"I want a coke"*, *"buy me a latte"*, or *"cappuccino"*
2. Agent skips recommendations, goes straight to payment card
3. Same x402 flow: review payment summary → sign → settle → NFT

### Flow 3: Bazaar discovery data flow (demo behind-the-scenes)

1. Open `http://localhost:5173/debug/bazaar` (or click 🔬 near input hint)
2. Shows 4-step pipeline:
   - **Step 1** — Agent → Bazaar request (`GET /discovery/resources`)
   - **Step 2** — Bazaar → x402 response (`GET /products`) — raw product catalog with prices
   - **Step 3** — Bazaar → Agent response (transformed resources)
   - **Step 4** — Side-by-side: x402 Product ↔ Bazaar Resource transformation
3. Use search box to filter by keyword (e.g. "coffee")

### Flow 4: Merchant revenue dashboard

1. Open `http://localhost:5173/merchant`
2. Shows total revenue across all merchants with **named merchants** (Coffee Provider, Soft Drink Provider, Water Provider) — each card shows Revenue label
3. Use the **Time Range** dropdown (All Time / Last 24 Hours / Last Week / Last Month) to filter revenue
4. Click a merchant card → per-product sales, revenue, and recent purchases
5. Time range filter also works on individual merchant detail pages
6. Auto-refreshes every 5 seconds

### Flow 5: Transaction history

1. In the chat interface, click the **Transactions** button in the left sidebar (calendar icon)
2. Shows all completed purchases with timestamp, amount, transaction hash, and purchase ID
3. Click **Inventory** to see purchased items with NFT previews
4. Inventory and Transactions are mutually exclusive panels (clicking one closes the other)

---

## Architecture

```
                      GET /products
  ┌─────────┐  ◄───────────────────  ┌──────────┐
  │ Bazaar   │  { productId, name,    │  x402    │
  │ :3001    │    price, payTo, ... } │  Server  │
  └────┬─────┘  ────────────────────▶ │  :3002   │
       │                              └────┬─────┘
       │  Bazaar resource format           │
       │  { type, accepts[],               │ 402 flow:
       │    extensions.bazaar.info }       │ PAYMENT-REQUIRED
       │                                   │ PAYMENT-SIGNATURE
       │                                   │ PAYMENT-RESPONSE
  ┌────┴─────┐                      ┌──────┴─────┐
  │  Agent   │                      │ Facilitator │
  │ (Browser)│ ── settle ──────────▶│ (x402.org)  │
  └──────────┘                      └────────────┘
```

**Data flow:**
1. Agent queries Bazaar: *"what services exist?"*
2. Bazaar queries x402: `GET /products` → gets catalog with prices
3. Bazaar transforms to standard resource format → returns to agent
4. Agent fetches resource → gets HTTP 402 → sees Payment Summary → signs payment → facilitator settles

---

## Environment Variables (optional)

| Variable | Default | Description |
|---|---|---|
| `MERCHANT_COFFEE` | deterministic hash | Coffee provider wallet |
| `MERCHANT_SOFTDRINK` | deterministic hash | Soft drink provider wallet |
| `MERCHANT_WATER` | deterministic hash | Water provider wallet |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | Settlement facilitator |
| `USDC_ADDRESS` | `0x036CbD...dCF7e` | USDC on Base Sepolia |
| `PORT` | `3002` (x402), `3001` (bazaar) | Server ports |
| `CACHE_TTL` | `30000` | Bazaar cache TTL in ms |

---

## Product Catalog

| Product | Price | Merchant |
|---|---|---|
| Espresso | $2.99 | Coffee Provider |
| Latte | $3.49 | Coffee Provider |
| Cappuccino | $3.99 | Coffee Provider |
| Cold Brew | $3.29 | Coffee Provider |
| Coca-Cola Classic | $1.99 | Soft Drink Provider |
| Pepsi Cola | $1.89 | Soft Drink Provider |
| Sprite | $1.79 | Soft Drink Provider |
| Fanta Orange | $1.69 | Soft Drink Provider |
| Dasani Water | $0.99 | Water Provider |
| Smartwater | $1.49 | Water Provider |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `/debug/bazaar` shows empty/error | Start `x402server` first, then `mcpdiscovery`. Refresh. |
| 402 response body is `{}` in DevTools | Normal — the x402 protocol uses headers. Body is decoded copy for readability. |
| Payment fails with chain ID mismatch | Switch MetaMask to Base Sepolia. |
| Payment fails with `invalid_exact_evm_signature` | The v-fix in `signTypedData` should auto-correct the MetaMask v-value bug. If not, try Firefox or Rabby wallet. |
| Payment fails with `invalid_exact_evm_token_name_mismatch` | The `USDC_NAME` in `x402server/app.js` must match the on-chain token name. Base Sepolia Circle native USDC returns `"USDC"`. Bridged USDC (USDC.e) returns `"USD Coin"`. |
| Payment fails after signing | Get testnet USDC from faucet.circle.com. |
| "Facilitator error" in x402 logs | Check `https://x402.org/facilitator` is reachable. |
| Bazaar returns 0 resources | x402 server not reachable. Start x402 first, restart Bazaar. |
| MetaMask not detected | Install MetaMask extension, refresh page. |

---

## Running Tests

```bash
cd x402server && npm test     # 14 tests
cd ../mcpdiscovery && npm test # 11 tests
cd ../frontend && npm test     # 31 tests
```

## Recent UI Changes

- **Payment Summary** — PaymentCard now shows a detailed summary before paying (item, price, calories, what you receive, network, asset, pay-to wallet)
- **NFT auto-sizing** — NFT previews constrained to `max-width: 200px` (chat) / `180px` (inventory) with `object-fit: contain`
- **Transaction history** — new Transactions sidebar panel shows timestamp, amount, TX hash, and purchase ID
- **Merchant names** — merchants displayed as "Coffee Provider", "Soft Drink Provider", "Water Provider" instead of generic "Merchant"
- **Revenue labels** — each merchant card shows "Revenue" label below the name
- **Time range filter** — dropdown on merchant pages to filter by All Time / 24h / Week / Month
- **Product icons** — each product has a contextual emoji icon (☕ for coffee, 🥤 for soda, 💧 for water)
