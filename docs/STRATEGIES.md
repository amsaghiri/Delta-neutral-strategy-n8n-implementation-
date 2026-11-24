# Strategies

All rates are fractions of notional. `cost` is the round-trip cost of the scenario being evaluated.

## Sizing

- Spot + perp (carry, basis): `notional = capital / (1 + m)`, where `m = perpMarginFraction`. The spot leg
  is fully funded and `m × notional` sits as margin on the futures venue.
- Perp + perp: `notional = capital / (2m)`. Both legs need margin, each on its own venue.
- A price move of roughly `m` against a perp leg exhausts its margin (maintenance margin ignored).
  Delta-neutral means the two legs offset in profit and loss, **not** in margin: the losing leg can be
  liquidated while the winning leg's gain sits on another venue.

## 1. Funding carry (core)

Positive funding means longs pay shorts, so the position is long spot + short perp.

```
perDay        = 1440 / fundingPeriodMinutes          (24 on Kraken today)
daily24, 7d   = mean(relativeFundingRate over window) × perDay
expectedDaily = sign × min(|daily24|, |daily7d|)      (0 if the signs differ)
cost          = 2 × (spotFee + spotSlippage) + 2 × (perpFee + perpSlippage)
breakevenDays = cost / |expectedDaily|
netOverHold   = |expectedDaily| × holdDays − cost
```

A row passes when the print is fresh, the trade is executable, there are at least `minHistoryPoints`
prints in 7 days, at least `minSameSignFrac` of them share the 7-day sign, `breakevenDays ≤
maxBreakevenDays` and `netOverHold ≥ minNetOverHold`.

Negative funding reverses the trade (long perp + short spot). That needs a spot borrow, so it only passes
with `allowSpotShort: true`, and `spotBorrowDaily` is then deducted from the daily rate.

Limits: the expectation is a trailing average, not a forecast. Funding often collapses after a spike.

## 2. Perp-perp funding spread (experimental)

Short the perp on the venue with the higher funding and long it on the other. No spot leg, so it also
works when funding is negative.

```
spreadDaily = (krakenHourly(24h mean) − hyperliquidHourly(now)) × 24
cost        = 2 × (perpFee + perpSlippage) + 2 × (perp2Fee + perp2Slippage)
```

Dropped when the Hyperliquid mark and the Coinbase spot disagree by more than `maxVenuePriceGap`.

Limits: only a snapshot of Hyperliquid funding is used, with no persistence check on the spread, which is
why this strategy does not alert by default. Capital sits on two venues, one of them on-chain, and the
two perps can trade at different prices for long periods.

## 3. Dated-futures basis (experimental)

Long spot + short a fixed-maturity future trading above spot. The future converges to spot at expiry, so
the return is fixed at entry and does not depend on later funding prints.

```
basis        = futureBid / spot − 1
cost         = 2 × (spotFee + spotSlippage) + (perpFee + perpSlippage) + futuresSettleFee
net          = basis − cost
annualised   = net × notional / capital × 365 / daysToExpiry
```

Passes when `basis > 0`, at least `minBasisDays` remain, and the annualised net is at least
`minBasisAnnualized`. Inverse (coin-margined, `FI_`) contracts are listed but never pass, because their
hedge ratio is not constant. Negative basis would need a spot short and is not traded.

Limits: the return is locked only if the position is held to expiry and never liquidated on the way.

## Ideas not implemented

- Funding carry with a staking-yield spot leg (for example a liquid-staking token as the long leg).
- Rotating the carry position across assets by rank instead of judging each asset alone.
- A persistence check on the cross-venue spread using Hyperliquid's funding history.
