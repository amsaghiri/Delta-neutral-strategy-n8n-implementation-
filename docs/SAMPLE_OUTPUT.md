# Sample output

Rendered by `buildReport` from **synthetic** inputs (made-up funding rates chosen so that every branch
shows up). These are not market observations.

```
<b>DSFAB — Insight</b>
Workflow: DSFAB Process 3 — delta-neutral radar
Time: 2026-11-23T12:20:00.000Z
Capital $500 | perp margin 50% → notional $333 per leg (spot+perp) | hold 30d | fresh 4/4

🔎 <b>Funding carry (spot + perp)</b>
<u>Maker</u> (round-trip cost 0.92%): 
• <b>BTC</b> | exp 0.240%/day | breakeven 3.8d | net 6.28% ($20.93) | ≈50.9%/yr | Short perp (KR) + Long spot (CB)
<u>Base</u> (round-trip cost 1.50%): 
• <b>BTC</b> | exp 0.240%/day | breakeven 6.3d | net 5.70% ($19.00) | ≈46.2%/yr | Short perp (KR) + Long spot (CB)
<u>Stress</u> (round-trip cost 1.90%): 
• <b>BTC</b> | exp 0.240%/day | breakeven 7.9d | net 5.30% ($17.67) | ≈43.0%/yr | Short perp (KR) + Long spot (CB)
❌ Closest misses (Base):
• ETH | net 6.24% | needs spot short
• XRP | net 2.10% | unstable sign
• SOL | net -0.64% | breakeven too long, net too small

🔎 <b>Perp-perp spread (experimental)</b>
<u>Maker</u> (round-trip cost 0.15%): 
• <b>ETH</b> | exp 0.336%/day | breakeven 0.4d | net 9.93% ($49.65) | ≈120.8%/yr | Long perp (KR) + Short perp (HL)
• <b>BTC</b> | exp 0.216%/day | breakeven 0.7d | net 6.33% ($31.65) | ≈77.0%/yr | Short perp (KR) + Long perp (HL)
<u>Base</u> (round-trip cost 0.39%): 
• <b>ETH</b> | exp 0.336%/day | breakeven 1.2d | net 9.69% ($48.45) | ≈117.9%/yr | Long perp (KR) + Short perp (HL)
• <b>BTC</b> | exp 0.216%/day | breakeven 1.8d | net 6.09% ($30.45) | ≈74.1%/yr | Short perp (KR) + Long perp (HL)
<u>Stress</u> (round-trip cost 0.79%): 
• <b>ETH</b> | exp 0.336%/day | breakeven 2.4d | net 9.29% ($46.45) | ≈113.0%/yr | Long perp (KR) + Short perp (HL)
• <b>BTC</b> | exp 0.216%/day | breakeven 3.7d | net 5.69% ($28.45) | ≈69.2%/yr | Short perp (KR) + Long perp (HL)
❌ Closest misses (Base):
• SOL | net -0.25% | breakeven too long, net too small

🔎 <b>Dated-futures basis (experimental)</b>
<u>Maker</u> (round-trip cost 0.88%): 
• <b>FF_XBTUSD_261225</b> | basis 3.11% | 32d | net 2.23% ($7.45) | ≈17.0%/yr on capital
<u>Base</u> (round-trip cost 1.40%): 
• <b>FF_XBTUSD_261225</b> | basis 3.11% | 32d | net 1.71% ($5.72) | ≈13.0%/yr on capital
<u>Stress</u> (round-trip cost 1.70%): 
• <b>FF_XBTUSD_261225</b> | basis 3.11% | 32d | net 1.41% ($4.72) | ≈10.8%/yr on capital


<b>DSFAB — Data Health</b>
Assets: 4 | price ok: 4 | funding ok: 4 | fresh: 4
Funding cadence (median): 60m | last print age min/med/max: 20/20/20m
Hyperliquid assets parsed: 3 | Kraken dated contracts parsed: 1

<b>DSFAB — Funding table (per day)</b>
<pre>ASSET PRICE       NOW/d    24h/d    7d/d     SIGN7d AGEm
BTC   $61000.0000 0.240%   0.240%   0.240%   100%   20
ETH   $1700.0000  -0.288%  -0.288%  -0.288%  100%   20
SOL   $72.0000    0.029%   0.029%   0.029%   100%   20
XRP   $0.9400     0.480%   0.120%   0.120%   50%    20</pre>

✅ <b>DSFAB PICK</b> (Base costs)
BTC — Short perp (KR) + Long spot (CB)
expected 0.240%/day | breakeven 6.3d
net over 30d: $19.00 on $333 notional
Funding print valid until 2026-11-23T13:00:00.000Z (≈ 40m)
```
