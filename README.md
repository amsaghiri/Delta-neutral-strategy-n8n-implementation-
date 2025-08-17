# SmartWallet – Process 3 (DSFAB)
**Delta-Stable Funding Arbitrage Bot – Fresh-Only Scanner & Long Report**  
n8n workflow that scans Coinbase spot + Kraken Futures perps, enforces data freshness, and produces a long HTML report, health diagnostics, and Telegram alerts. Logs go to Google Sheets.

> **Not financial advice. For research/education.** See [DISCLAIMER](DISCLAIMER.md).

## What it does (quick)
- Fetches **Coinbase spot prices** and **Kraken Futures funding** for a 20-asset universe.
- Infers **exchange cadence** from Kraken timestamps and builds a **fresh-only** trade universe.
- Runs multiple **scenarios** and an **auto-scanner grid** to surface profitable edges after estimated fees/slippage/borrow.
- Emits:
  - **Insight report** (HTML) with best candidates + TTL from exchange time.
  - **Data health** + **price table** (HTML with `<pre>`).
  - **Alert** message if any profitable pick exists.
  - **Append-only logs** to Google Sheets (with fresh/age/validUntil/remainMin).

## Repo layout
```
.
├─ workflow/
│  └─ Smart_Wallet_Process_3_base_version_15_long_report+order_detail_time.json
├─ docs/
│  ├─ ARCHITECTURE.md
│  └─ SAMPLE_OUTPUT.md
├─ .github/
│  └─ ISSUE_TEMPLATE/
│     ├─ bug_report.md
│     └─ feature_request.md
├─ .gitignore
├─ LICENSE
├─ README.md
├─ DISCLAIMER.md
├─ SECURITY.md
├─ CONTRIBUTING.md
└─ CHANGELOG.md
```

## Import into n8n
1. Open **n8n → Workflows → Import from file**.
2. Choose `workflow/Smart_Wallet_Process_3_base_version_15_long_report+order_detail_time.json`.
3. After import, open the workflow and:
   - Replace placeholder credentials for **Telegram** or disable Telegram nodes.
   - Update the **Google Sheets** node with your own `documentId` and `sheetName` (or disable it).
   - (Optional) Adjust **Scenario Configs** node arrays and `freshness` policy.

## Required settings / secrets
The workflow includes placeholder values. Replace them with your own:
- **Telegram**: `YOUR_BOT_TOKEN`, `YOUR_CHAT_ID` (or use the n8n Telegram credentials node)
- **Google Sheets**: `YOUR_SHEET_ID` (document ID) and sheet name, e.g. `DSFAB_Logs`.
- **Webhooks** listed are dummy. You can remove the HTTP Fallback nodes if you only use the Telegram node with credentials.

> Tip: Keep secrets outside the repo. Example `.env` (do not commit):
```
TELEGRAM_BOT_TOKEN=123:abc
TELEGRAM_CHAT_ID=87201238
GOOGLE_SHEET_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## How it decides “freshness”
- Parses Kraken funding timestamps and computes a **median age** across assets.
- Infers cadence (`~60m`, `~240m`, `~480m`) and sets an **effective fresh window** (`max(freshness.maxFundingAgeMin, cadence*1.5)`).
- Keeps only assets that:
  - Have price ≥ `freshness.minPriceUSD`
  - Have non-zero funding unless `allowZeroFunding` is `true`
  - Are within the **effective** fresh window

## Outputs
- **Insight report (HTML)** with sections for each scenario and an **Auto-Scanner** top-3.  
- **Data Health (HTML)** and **Data Health (Prices)** tables.  
- **Alert** (HTML) if profitable edge exists, including `VALID UNTIL` derived from exchange cadence.

## Google Sheets schema
The `Google Sheets — Append` node autoloads columns. Typical columns:
```
timestamp, scenario, asset, spotPrice, funding8h, fundingDailyPct, action,
capital, borrowed, notional, estDaily, label, profitable,
params.takerFee, params.slippage, params.borrowDaily, params.targetLTV, params.minProfitDailyPct,
krAgeMin, fresh, validUntil, remainMin
```

## Legal & API
- Respect **Coinbase** and **Kraken Futures** API rate limits and ToS.
- This project sends only **read** requests to public endpoints; no trading is performed here.

## Safety
- No orders are placed. It’s an analytics/radar workflow.
- If you extend to execution, add fail-safes: **LTV caps, TTL expiry, kill-switches, slippage/fee guards, and dry-run toggles**.

## Citation
If you use this in research, please cite as:
> A. M. Saghiri, *SmartWallet – DSFAB Process 3 (Research Release)*, 2025. GitHub repository.
