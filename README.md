# SmartWallet – Process 3 (DSFAB)

**Delta-neutral radar for n8n.** Every 15 minutes the workflow reads public market data, checks three
delta-neutral setups against a full round-trip cost model, and sends an HTML report, a data-health
report and (only when something clears the bar) an alert to Telegram. Every evaluated row is appended
to Google Sheets.

> **Not financial advice. Research/education only. No orders are placed.** See [DISCLAIMER](DISCLAIMER.md).

## What it checks

| Strategy | Legs | Data | Status |
| --- | --- | --- | --- |
| Funding carry | Long spot (Coinbase) + short perp (Kraken Futures) | Coinbase ticker, Kraken funding history | Core |
| Perp-perp spread | Opposite perps on Kraken Futures and Hyperliquid | Kraken funding history, Hyperliquid snapshot | Experimental |
| Dated-futures basis | Long spot + short fixed-maturity future (Kraken) | Coinbase ticker, Kraken tickers | Experimental |

Details, formulas and limits of each one: [docs/STRATEGIES.md](docs/STRATEGIES.md).

## How a signal is judged

- **Funding is read correctly.** Kraken's `relativeFundingRate` (a fraction of notional per funding
  period) is used, and the funding period is measured from the timestamps (hourly at the time of writing),
  so the daily rate is `rate × 24`. The absolute `fundingRate` field is ignored.
- **Costs are one-off, funding is a flow.** A position has four fills (open and close on two legs).
  The report shows **breakeven days** = round-trip cost ÷ expected daily funding, and the **net over
  `holdDays`** after that cost.
- **One print is not a forecast.** The expected rate is the weaker of the 24-hour and 7-day means, and it
  is zero when the two disagree in sign. An asset also needs enough history and a stable sign over 7 days.
- **Negative funding is not silently "profitable".** It needs a spot short, which Coinbase spot does not
  offer. Those rows are reported with the reason `needs spot short` unless `allowSpotShort` is set.
- **Alerts use the `alertScenario` costs** (default `Base`), never the cheapest scenario. Experimental
  strategies appear in the report but do not trigger alerts unless `alertOnExperimental` is true.
- **Freshness.** A funding print older than `max(freshness.maxFundingAgeMin, 1.5 × period)` is stale and
  cannot pass. The alert carries the time the current print stops being the latest one.

## Repo layout

```
.
├─ workflow/dsfab_process3.json   # import this into n8n (generated, do not edit by hand)
├─ src/
│  ├─ core.js                     # all analysis logic, pure functions
│  ├─ backtest.js                 # walk-forward backtest of the carry rule
│  ├─ assets.js                   # asset universe and venue symbols
│  └─ nodes/                      # bodies of the n8n Code nodes
├─ scripts/
│  ├─ build-workflow.js           # src/ -> workflow/dsfab_process3.json
│  ├─ fetch-history.js            # download Kraken funding history to data/
│  └─ backtest.js                 # run the backtest on data/
├─ test/                          # node:test suite (no dependencies)
├─ docs/                          # ARCHITECTURE, STRATEGIES, SAMPLE_OUTPUT
├─ legacy/                        # zipped 2025-08 release, for reference only
└─ README, LICENSE, DISCLAIMER, SECURITY, CONTRIBUTING, CHANGELOG
```

## Import into n8n

1. **n8n → Workflows → Import from file** → `workflow/dsfab_process3.json`.
2. Open each **Telegram** node, pick your Telegram credential and replace `YOUR_CHAT_ID`
   (or disable the Telegram nodes).
3. Open **Google Sheets — Append**, pick your credential and replace `YOUR_SHEET_ID` and the sheet
   name (or disable the node).
4. Open **Scenario Configs** and set the fees to **your** fee tier on each venue. The defaults are examples.
5. Run once manually and read the **Data Health** message before trusting any signal.

## Configuration (the `Scenario Configs` node)

| Key | Default | Meaning |
| --- | --- | --- |
| `capitalUSD` | 500 | Total capital across both legs |
| `perpMarginFraction` | 0.5 | Margin kept per perp leg as a fraction of its notional (0.5 = 2x) |
| `holdDays` | 30 | Planning horizon for "net over hold" |
| `scenarios[]` | Maker / Base / Stress | Per-leg `spotFee`, `spotSlippage`, `perpFee`, `perpSlippage`, `perp2Fee`, `perp2Slippage` as fractions |
| `alertScenario` | `Base` | Scenario an alert must pass |
| `alertOnExperimental` | false | Let experimental strategies trigger alerts |
| `strategies` | all true | Switch each strategy on or off |
| `allowSpotShort`, `spotBorrowDaily` | false, 0.0003 | Enable the negative-funding branch if you can short spot elsewhere |
| `freshness` | 130 min, $0.2 | Maximum funding age, minimum price |
| `policy` | see node | `minHistoryPoints`, `minSameSignFrac`, `maxBreakevenDays`, `minNetOverHold`, `minBasisDays`, `minBasisAnnualized`, `maxVenuePriceGap` |
| `sanity` | 1%/h, 20% | Funding prints or basis values beyond these are discarded as bad data |

The `Base` spot fee (0.60% taker) follows Coinbase Exchange's published schedule for under $10k of
30-day volume; perp fees are placeholders. Check your own tiers.

## Develop, test, backtest

Requires Node.js 18+. No dependencies.

```bash
npm test                 # rebuilds the workflow, then runs the test suite
npm run build            # src/ -> workflow/dsfab_process3.json
npm run fetch-history    # Kraken funding history -> data/<SYMBOL>.json
npm run backtest         # carry rule on data/, Base costs
node scripts/backtest.js data --scenario Maker --capital 5000 --allow-spot-short
```

The backtest models funding and trading costs only. It does not model basis moves, margin calls,
liquidation, withdrawal fees or taxes, so treat its output as an upper bound.

## Google Sheets columns

```
timestamp, strategy, scenario, asset, symbol, spotPrice, direction, executable, pass, reasons,
expectedDailyPct, daily24Pct, daily7dPct, sameSignFrac7d, roundTripCostPct, breakevenDays,
netOverHoldPct, netUsd, annualOnCapitalPct, notional, ageMin, fresh, validUntil
```

If you logged with the 2025-08 version, start a new sheet: the columns changed.

## What has and has not been verified

- Verified against the live API (2026-11-24): the shape of Kraken's `historical-funding-rates` response
  and its hourly spacing, for `PF_XBTUSD` and `PF_ETHUSD`.
- Covered by tests with mocked data: all analysis logic, the generated workflow's structure, and the Code
  nodes end to end.
- **Not yet verified:** an import and live run of this workflow in n8n; the live response shapes of
  Kraken `/tickers` and Hyperliquid `/info`; that every symbol in `src/assets.js` is still listed on each
  venue. The Data Health message reports what parsed. Parsers return "no data" rather than a wrong
  number when a shape does not match.

## Legal & API

- Only public, read-only endpoints are called. Respect each venue's rate limits and terms.
- If you extend this to execution, add LTV caps, signal expiry, kill-switches, slippage guards and a
  dry-run mode first.

## Citation

> A. M. Saghiri, *SmartWallet – DSFAB Process 3 (Research Release)*, 2025. GitHub repository.
