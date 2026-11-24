/* Walk-forward backtest of the funding-carry rule on one funding series.
 * Price moves are assumed hedged (delta-neutral); only funding and trading costs are modelled. */
const core = require('./core');

function runBacktest(series, cadenceMin, sc, userCfg) {
  const cfg = core.mergeConfig(userCfg);
  const cost = core.costModel(sc).carryRoundTrip;
  const sz = core.sizing(cfg);
  let pos = 0, trades = 0, gross = 0, costs = 0, inPeriods = 0, alwaysIn = 0;
  const start = Math.min(series.length, cfg.policy.minHistoryPoints);
  for (let i = start; i < series.length; i++) {
    // decision uses data up to i-1; the print at i is then earned or paid
    const st = core.fundingStats(series.slice(Math.max(0, i - 800), i), cadenceMin, series[i - 1].t);
    if (pos === 0) {
      const r = core.analyzeCarry('X', 1, st, sc, cfg, true);
      if (r.pass) { pos = r.direction === 'SHORT_PERP_LONG_SPOT' ? 1 : -1; trades++; costs += cost; }
    } else if (st.daily24 !== null && Math.sign(st.daily24) === -pos) {
      pos = 0;
    }
    const rel = series[i].rel;
    alwaysIn += rel;
    if (pos !== 0) {
      gross += pos * rel - (pos === -1 ? cfg.spotBorrowDaily * cadenceMin / 1440 : 0);
      inPeriods++;
    }
  }
  const periods = Math.max(0, series.length - start);
  const spanDays = (periods * cadenceMin) / 1440;
  const net = gross - costs;
  const toAnnualOnCapital = (x) => (spanDays > 0 ? (x * sz.notional / cfg.capitalUSD) * (365 / spanDays) : 0);
  return {
    periods, spanDays, trades, timeInMarket: periods ? inPeriods / periods : 0,
    grossFunding: gross, costs, net, netUsd: net * sz.notional,
    annualOnCapital: toAnnualOnCapital(net),
    alwaysInNet: alwaysIn - cost, alwaysInAnnualOnCapital: toAnnualOnCapital(alwaysIn - cost)
  };
}
module.exports = { runBacktest };
