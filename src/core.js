/* DSFAB core — pure analysis logic (no network, no n8n globals).
 * This file is the single source of truth. scripts/build-workflow.js inlines it
 * into the n8n Code nodes, and the tests / backtest import it directly.
 *
 * Units used everywhere below:
 *   rate  = fraction of notional (0.0001 = 0.01%)
 *   *Daily = fraction of notional per day
 */

// ---------- small helpers ----------
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}
function toMs(t) {
  if (t === null || t === undefined || t === '') return null;
  const n = +t;
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(t);
  return Number.isFinite(d) ? d : null;
}
function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function sign(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- configuration ----------
function defaultConfig() {
  return {
    capitalUSD: 500,
    // Fraction of the perp notional kept as margin on the futures venue.
    // 0.5 = 2x on the perp leg. The rest of the capital buys the spot leg.
    perpMarginFraction: 0.5,
    holdDays: 30, // planning horizon used for "net over hold"
    // Cost scenarios. Fees are PER LEG, as a fraction of notional.
    // These are examples only: set them to YOUR fee tier on each venue.
    scenarios: [
      { name: 'Maker', spotFee: 0.004, spotSlippage: 0.0002, perpFee: 0.0002, perpSlippage: 0.0002, perp2Fee: 0.00015, perp2Slippage: 0.0002 },
      { name: 'Base', spotFee: 0.006, spotSlippage: 0.0005, perpFee: 0.0005, perpSlippage: 0.0005, perp2Fee: 0.00045, perp2Slippage: 0.0005 },
      { name: 'Stress', spotFee: 0.006, spotSlippage: 0.0015, perpFee: 0.0005, perpSlippage: 0.0015, perp2Fee: 0.00045, perp2Slippage: 0.0015 }
    ],
    alertScenario: 'Base', // alerts are judged under this scenario, never the cheapest one
    alertOnExperimental: false,
    strategies: { fundingCarry: true, perpPerpSpread: true, datedBasis: true },
    // Spot shorting (needed when funding is negative) is not available on
    // Coinbase spot. Leave false unless you have a margin venue for the spot leg.
    allowSpotShort: false,
    spotBorrowDaily: 0.0003, // only used when allowSpotShort is true
    futuresSettleFee: 0, // fee charged at expiry settlement of a dated future
    freshness: { maxFundingAgeMin: 130, minPriceUSD: 0.2 },
    policy: {
      minHistoryPoints: 120, // at least ~5 days of hourly prints before trusting an asset
      minSameSignFrac: 0.7, // share of the last 7d prints that agree with the 7d mean sign
      maxBreakevenDays: 20,
      minNetOverHold: 0.002, // net return on notional over holdDays, after round-trip cost
      minBasisDays: 3,
      minBasisAnnualized: 0.03,
      maxVenuePriceGap: 0.03 // drop cross-venue signals if prices disagree by more than this
    },
    sanity: { maxAbsHourlyRate: 0.01, maxAbsBasis: 0.2 }
  };
}
function mergeConfig(user) {
  const d = defaultConfig();
  if (!user || typeof user !== 'object') return d;
  const out = Object.assign({}, d, user);
  for (const k of ['strategies', 'freshness', 'policy', 'sanity']) {
    out[k] = Object.assign({}, d[k], user[k] || {});
  }
  if (!Array.isArray(out.scenarios) || !out.scenarios.length) out.scenarios = d.scenarios;
  return out;
}

// ---------- Kraken Futures funding history ----------
// GET /derivatives/api/v3/historical-funding-rates?symbol=PF_XBTUSD
// -> { result, serverTime, rates: [{ timestamp, fundingRate, relativeFundingRate }] }
// `fundingRate` is ABSOLUTE (quote currency per contract); only `relativeFundingRate`
// is a fraction of notional, and it is per funding period (hourly on Kraken).
function parseKrakenFunding(body, sanity) {
  const maxAbs = (sanity && sanity.maxAbsHourlyRate) || 0.01;
  const arr = body && Array.isArray(body.rates) ? body.rates : null;
  if (!arr) return { ok: false, reason: 'kr_no_rates', series: [], cadenceMin: 60 };
  const series = [];
  let dropped = 0;
  for (const r of arr) {
    const t = toMs(r && r.timestamp);
    const rel = num(r && r.relativeFundingRate);
    if (t === null || rel === null) { dropped++; continue; }
    if (Math.abs(rel) > maxAbs) { dropped++; continue; }
    series.push({ t, rel });
  }
  if (!series.length) return { ok: false, reason: 'kr_no_relative_rate', series: [], cadenceMin: 60 };
  series.sort((a, b) => a.t - b.t);
  const tail = series.slice(-49);
  const diffs = [];
  for (let i = 1; i < tail.length; i++) diffs.push((tail[i].t - tail[i - 1].t) / 60000);
  const med = median(diffs);
  const cadenceMin = med && med > 0 ? Math.round(med) : 60;
  return { ok: true, reason: null, series, cadenceMin, dropped };
}

function windowStats(series, fromMs) {
  const w = [];
  for (let i = series.length - 1; i >= 0 && series[i].t > fromMs; i--) w.push(series[i].rel);
  return { n: w.length, mean: mean(w), values: w };
}

function fundingStats(series, cadenceMin, nowMs) {
  if (!series.length) return null;
  const perDay = 1440 / cadenceMin;
  const last = series[series.length - 1];
  const H = 3600000;
  const w24 = windowStats(series, last.t - 24 * H);
  const w7 = windowStats(series, last.t - 168 * H);
  const w30 = windowStats(series, last.t - 720 * H);
  const s7 = sign(w7.mean || 0);
  const agree = w7.values.filter((x) => sign(x) === s7 && s7 !== 0).length;
  const sameSignFrac7d = w7.n ? agree / w7.n : 0;
  const daily24 = w24.mean === null ? null : w24.mean * perDay;
  const daily7d = w7.mean === null ? null : w7.mean * perDay;
  const daily30d = w30.mean === null ? null : w30.mean * perDay;
  // Conservative expectation: the weaker of the 24h and 7d means, and zero if they disagree in sign.
  let expectedDaily = 0;
  if (daily24 !== null && daily7d !== null && sign(daily24) === sign(daily7d) && sign(daily7d) !== 0) {
    expectedDaily = sign(daily7d) * Math.min(Math.abs(daily24), Math.abs(daily7d));
  }
  const ageMin = Math.max(0, (nowMs - last.t) / 60000);
  return {
    cadenceMin, perDay,
    lastRel: last.rel, lastTs: last.t, ageMin,
    dailyNow: last.rel * perDay,
    daily24, daily7d, daily30d,
    n7d: w7.n, sameSignFrac7d, expectedDaily,
    validUntilMs: last.t + cadenceMin * 60000,
    remainMin: Math.max(0, cadenceMin - ageMin)
  };
}

// ---------- cost model ----------
// A delta-neutral position has FOUR fills: open + close on each of two legs.
// Costs are one-off; funding accrues over time. They must never be netted per day.
function costModel(sc) {
  const spotLeg = sc.spotFee + sc.spotSlippage;
  const perpLeg = sc.perpFee + sc.perpSlippage;
  const perp2Leg = (sc.perp2Fee === undefined ? sc.perpFee : sc.perp2Fee) + (sc.perp2Slippage === undefined ? sc.perpSlippage : sc.perp2Slippage);
  return {
    spotLeg, perpLeg, perp2Leg,
    carryRoundTrip: 2 * spotLeg + 2 * perpLeg,
    perpPerpRoundTrip: 2 * perpLeg + 2 * perp2Leg,
    // buy spot, sell future, (future settles at expiry), sell spot
    basisRoundTrip: 2 * spotLeg + perpLeg
  };
}
// Capital split. Spot + perp: the spot leg is fully funded and the perp leg needs margin m.
// Perp + perp: both legs need margin m on their own venue.
function sizing(cfg, twoPerps) {
  const m = cfg.perpMarginFraction;
  const notional = twoPerps ? cfg.capitalUSD / (2 * m) : cfg.capitalUSD / (1 + m);
  // Rough distance to margin exhaustion on a perp leg (ignores maintenance margin).
  return { notional, perpMarginUSD: notional * m, liqBufferPct: m };
}
function evaluate(dailyNet, cost, cfg, twoPerps) {
  const H = cfg.holdDays;
  const breakevenDays = dailyNet > 0 ? cost / dailyNet : Infinity;
  const netOverHold = dailyNet * H - cost;
  const sz = sizing(cfg, twoPerps);
  const netUsd = netOverHold * sz.notional;
  const annualOnCapital = (netUsd / cfg.capitalUSD) * (365 / H);
  return { breakevenDays, netOverHold, netUsd, annualOnCapital, notional: sz.notional };
}

// ---------- strategy 1: funding carry (spot vs perp) ----------
function analyzeCarry(asset, price, st, sc, cfg, fresh) {
  const cost = costModel(sc).carryRoundTrip;
  const e = st.expectedDaily;
  const dir = e > 0 ? 'SHORT_PERP_LONG_SPOT' : e < 0 ? 'LONG_PERP_SHORT_SPOT' : 'NONE';
  const needsSpotShort = dir === 'LONG_PERP_SHORT_SPOT';
  const executable = dir === 'SHORT_PERP_LONG_SPOT' || (needsSpotShort && cfg.allowSpotShort);
  const dailyNet = Math.abs(e) - (needsSpotShort ? cfg.spotBorrowDaily : 0);
  const ev = evaluate(dailyNet, cost, cfg);
  const p = cfg.policy;
  const reasons = [];
  if (!fresh) reasons.push('stale');
  if (dir === 'NONE') reasons.push('24h/7d sign disagree');
  if (!executable && dir !== 'NONE') reasons.push('needs spot short');
  if (st.n7d < p.minHistoryPoints) reasons.push('short history');
  if (st.sameSignFrac7d < p.minSameSignFrac) reasons.push('unstable sign');
  if (!(ev.breakevenDays <= p.maxBreakevenDays)) reasons.push('breakeven too long');
  if (ev.netOverHold < p.minNetOverHold) reasons.push('net too small');
  return Object.assign({
    strategy: 'fundingCarry', scenario: sc.name, asset, spotPrice: price,
    direction: dir, executable, expectedDaily: e, dailyNow: st.dailyNow,
    daily24: st.daily24, daily7d: st.daily7d, daily30d: st.daily30d,
    sameSignFrac7d: st.sameSignFrac7d, roundTripCost: cost,
    ageMin: st.ageMin, fresh, validUntilMs: st.validUntilMs, remainMin: st.remainMin,
    pass: reasons.length === 0, reasons
  }, ev);
}

// ---------- strategy 2: perp-perp funding spread (Kraken vs Hyperliquid) ----------
// Needs no spot leg, so it also works when funding is negative.
// Hyperliquid funding is hourly. EXPERIMENTAL: only a snapshot of the second venue is used.
function parseHyperliquid(body, sanity) {
  const maxAbs = (sanity && sanity.maxAbsHourlyRate) || 0.01;
  const out = {};
  if (!Array.isArray(body) || body.length < 2) return out;
  const uni = body[0] && Array.isArray(body[0].universe) ? body[0].universe : [];
  const ctx = Array.isArray(body[1]) ? body[1] : [];
  for (let i = 0; i < uni.length && i < ctx.length; i++) {
    const name = uni[i] && uni[i].name;
    const f = num(ctx[i] && ctx[i].funding);
    const px = num(ctx[i] && (ctx[i].markPx !== undefined ? ctx[i].markPx : ctx[i].oraclePx));
    if (!name || f === null || px === null || Math.abs(f) > maxAbs) continue;
    out[String(name).toUpperCase()] = { hourly: f, price: px };
  }
  return out;
}
function analyzePerpPerp(asset, price, st, hl, sc, cfg, fresh) {
  const cost = costModel(sc).perpPerpRoundTrip;
  const krHourly = (st.daily24 === null ? st.dailyNow : st.daily24) / 24;
  const spreadDaily = (krHourly - hl.hourly) * 24;
  const dir = spreadDaily > 0 ? 'SHORT_KRAKEN_LONG_HL' : spreadDaily < 0 ? 'LONG_KRAKEN_SHORT_HL' : 'NONE';
  const ev = evaluate(Math.abs(spreadDaily), cost, cfg, true);
  const p = cfg.policy;
  const gap = price > 0 ? Math.abs(hl.price / price - 1) : Infinity;
  const reasons = [];
  if (!fresh) reasons.push('stale');
  if (dir === 'NONE') reasons.push('no spread');
  if (gap > p.maxVenuePriceGap) reasons.push('venue price gap');
  if (!(ev.breakevenDays <= p.maxBreakevenDays)) reasons.push('breakeven too long');
  if (ev.netOverHold < p.minNetOverHold) reasons.push('net too small');
  return Object.assign({
    strategy: 'perpPerpSpread', experimental: true, scenario: sc.name, asset, spotPrice: price,
    direction: dir, executable: true, expectedDaily: spreadDaily,
    krDaily: krHourly * 24, hlDaily: hl.hourly * 24, venuePriceGap: gap, roundTripCost: cost,
    ageMin: st.ageMin, fresh, validUntilMs: st.validUntilMs, remainMin: st.remainMin,
    pass: reasons.length === 0, reasons
  }, ev);
}

// ---------- strategy 3: dated-futures basis (cash and carry) ----------
// Long spot + short a fixed-maturity future. The return is locked at entry
// (basis converges at expiry), so it does not depend on future funding prints.
// EXPERIMENTAL: reads Kraken /tickers; symbols like FF_XBTUSD_YYMMDD / FI_XBTUSD_YYMMDD.
function parseKrakenDated(body) {
  const arr = body && Array.isArray(body.tickers) ? body.tickers : [];
  const out = [];
  for (const t of arr) {
    const m = /^(FF|FI)_([A-Z]+)USD_(\d{2})(\d{2})(\d{2})$/.exec(String((t && t.symbol) || '').toUpperCase());
    if (!m) continue;
    const price = num(t.bid) || num(t.markPrice) || num(t.last);
    if (!price) continue;
    const expiryMs = Date.UTC(2000 + +m[3], +m[4] - 1, +m[5], 12, 0, 0);
    out.push({
      symbol: m[0], asset: m[2] === 'XBT' ? 'BTC' : m[2], inverse: m[1] === 'FI',
      price, indexPrice: num(t.indexPrice), expiryMs
    });
  }
  return out;
}
function analyzeBasis(c, spot, sc, cfg, nowMs) {
  const S = spot > 0 ? spot : c.indexPrice;
  const cost = costModel(sc).basisRoundTrip + (cfg.futuresSettleFee || 0);
  const days = (c.expiryMs - nowMs) / 86400000;
  const basis = S > 0 ? c.price / S - 1 : NaN;
  const net = basis - cost;
  const sz = sizing(cfg);
  const netUsd = net * sz.notional;
  const annualOnCapital = days > 0 ? (netUsd / cfg.capitalUSD) * (365 / days) : NaN;
  const p = cfg.policy;
  const reasons = [];
  if (!Number.isFinite(basis)) reasons.push('no spot price');
  if (Math.abs(basis) > cfg.sanity.maxAbsBasis) reasons.push('basis out of range');
  if (c.inverse) reasons.push('inverse contract');
  if (!(days >= p.minBasisDays)) reasons.push('too close to expiry');
  if (!(basis > 0)) reasons.push('needs spot short');
  if (!(annualOnCapital >= p.minBasisAnnualized)) reasons.push('yield too small');
  return {
    strategy: 'datedBasis', experimental: true, scenario: sc.name, asset: c.asset, symbol: c.symbol,
    spotPrice: S, futurePrice: c.price, direction: 'LONG_SPOT_SHORT_FUTURE', executable: basis > 0,
    basis, daysToExpiry: days, roundTripCost: cost, netOverHold: net, netUsd, annualOnCapital,
    notional: sz.notional, breakevenDays: null, expectedDaily: days > 0 ? basis / days : 0,
    pass: reasons.length === 0, reasons
  };
}

// ---------- snapshot -> full analysis ----------
// snapshot = { timestamp, assets:[{asset, price, kr:{ok,reason,series,cadenceMin}, errors:[]}],
//              hl:{ASSET:{hourly,price}}, dated:[...] }
function analyzeSnapshot(snapshot, userCfg, nowMs) {
  const cfg = mergeConfig(userCfg);
  const results = [];
  const health = [];
  for (const a of snapshot.assets) {
    const st = a.kr && a.kr.ok ? fundingStats(a.kr.series, a.kr.cadenceMin, nowMs) : null;
    const priceOk = Number.isFinite(a.price) && a.price >= cfg.freshness.minPriceUSD;
    const window = st ? Math.max(cfg.freshness.maxFundingAgeMin, Math.round(st.cadenceMin * 1.5)) : cfg.freshness.maxFundingAgeMin;
    const fresh = !!st && priceOk && st.ageMin <= window;
    health.push({ asset: a.asset, price: a.price, st, fresh, errors: a.errors || [] });
    if (!st || !priceOk) continue;
    for (const sc of cfg.scenarios) {
      if (cfg.strategies.fundingCarry) results.push(analyzeCarry(a.asset, a.price, st, sc, cfg, fresh));
      const hl = snapshot.hl && snapshot.hl[a.asset];
      if (cfg.strategies.perpPerpSpread && hl) results.push(analyzePerpPerp(a.asset, a.price, st, hl, sc, cfg, fresh));
    }
  }
  if (cfg.strategies.datedBasis && Array.isArray(snapshot.dated)) {
    const px = {};
    for (const a of snapshot.assets) px[a.asset] = a.price;
    for (const c of snapshot.dated) for (const sc of cfg.scenarios) results.push(analyzeBasis(c, px[c.asset], sc, cfg, nowMs));
  }
  return { cfg, results, health };
}

// ---------- reporting ----------
const pct = (v, d) => (Number.isFinite(v) ? (v * 100).toFixed(d === undefined ? 3 : d) + '%' : 'n/a');
const days = (v) => (Number.isFinite(v) ? v.toFixed(1) + 'd' : '∞');
const DIR_TEXT = {
  SHORT_PERP_LONG_SPOT: 'Short perp (KR) + Long spot (CB)',
  LONG_PERP_SHORT_SPOT: 'Long perp (KR) + Short spot',
  SHORT_KRAKEN_LONG_HL: 'Short perp (KR) + Long perp (HL)',
  LONG_KRAKEN_SHORT_HL: 'Long perp (KR) + Short perp (HL)',
  LONG_SPOT_SHORT_FUTURE: 'Long spot (CB) + Short dated future (KR)',
  NONE: 'No trade'
};
function fmtRemain(min) {
  const m = Math.max(0, Math.floor(min || 0));
  const h = Math.floor(m / 60);
  return (h > 0 ? h + 'h ' : '') + (m % 60) + 'm';
}
function truncateHtml(msg, limit) {
  const max = limit || 3900;
  if (msg.length <= max) return msg;
  const lines = msg.split('\n');
  const out = [];
  let len = 0;
  for (const l of lines) {
    if (len + l.length + 1 > max - 40) break;
    out.push(l);
    len += l.length + 1;
  }
  let res = out.join('\n');
  const opens = (res.match(/<pre>/g) || []).length;
  const closes = (res.match(/<\/pre>/g) || []).length;
  if (opens > closes) res += '</pre>';
  return res + '\n… (truncated)';
}
function lineFor(r) {
  if (r.strategy === 'datedBasis') {
    return `• <b>${escHtml(r.symbol)}</b> | basis ${pct(r.basis, 2)} | ${r.daysToExpiry.toFixed(0)}d | net ${pct(r.netOverHold, 2)} ($${r.netUsd.toFixed(2)}) | ≈${pct(r.annualOnCapital, 1)}/yr on capital`;
  }
  return `• <b>${escHtml(r.asset)}</b> | exp ${pct(Math.abs(r.expectedDaily))}/day | breakeven ${days(r.breakevenDays)} | net ${pct(r.netOverHold, 2)} ($${r.netUsd.toFixed(2)}) | ≈${pct(r.annualOnCapital, 1)}/yr | ${DIR_TEXT[r.direction]}`;
}
function buildReport(snapshot, userCfg, nowMs, workflowName) {
  const { cfg, results, health } = analyzeSnapshot(snapshot, userCfg, nowMs);
  const ts = new Date(nowMs).toISOString();
  const freshN = health.filter((h) => h.fresh).length;
  const sz = sizing(cfg);
  const titles = { fundingCarry: 'Funding carry (spot + perp)', perpPerpSpread: 'Perp-perp spread (experimental)', datedBasis: 'Dated-futures basis (experimental)' };
  const lines = [
    '<b>DSFAB — Insight</b>',
    `Workflow: ${escHtml(workflowName || 'DSFAB')}`,
    `Time: ${ts}`,
    `Capital $${cfg.capitalUSD} | perp margin ${(cfg.perpMarginFraction * 100).toFixed(0)}% → notional $${sz.notional.toFixed(0)} per leg (spot+perp) | hold ${cfg.holdDays}d | fresh ${freshN}/${health.length}`,
    ''
  ];
  for (const strat of Object.keys(titles)) {
    if (!cfg.strategies[strat]) continue;
    lines.push(`🔎 <b>${titles[strat]}</b>`);
    for (const sc of cfg.scenarios) {
      const rs = results.filter((r) => r.strategy === strat && r.scenario === sc.name);
      const good = rs.filter((r) => r.pass).sort((a, b) => b.netUsd - a.netUsd);
      const cm = costModel(sc);
      const rt = strat === 'fundingCarry' ? cm.carryRoundTrip : strat === 'perpPerpSpread' ? cm.perpPerpRoundTrip : cm.basisRoundTrip;
      lines.push(`<u>${escHtml(sc.name)}</u> (round-trip cost ${pct(rt, 2)}): ${good.length ? '' : 'none pass'}`);
      for (const r of good.slice(0, 5)) lines.push(lineFor(r));
    }
    const alertSc = cfg.alertScenario;
    const miss = results.filter((r) => r.strategy === strat && r.scenario === alertSc && !r.pass)
      .sort((a, b) => b.netUsd - a.netUsd).slice(0, 4);
    if (miss.length) {
      lines.push(`❌ Closest misses (${escHtml(alertSc)}):`);
      for (const r of miss) lines.push(`• ${escHtml(r.symbol || r.asset)} | net ${pct(r.netOverHold, 2)} | ${escHtml(r.reasons.join(', '))}`);
    }
    lines.push('');
  }

  // Health
  const ages = health.filter((h) => h.st).map((h) => h.st.ageMin).sort((a, b) => a - b);
  const cad = median(health.filter((h) => h.st).map((h) => h.st.cadenceMin));
  const errs = health.filter((h) => h.errors.length).map((h) => `${h.asset}(${h.errors.join(';')})`);
  const healthLines = [
    '<b>DSFAB — Data Health</b>',
    `Assets: ${health.length} | price ok: ${health.filter((h) => h.price > 0).length} | funding ok: ${health.filter((h) => h.st).length} | fresh: ${freshN}`,
    `Funding cadence (median): ${cad ? cad + 'm' : 'n/a'} | last print age min/med/max: ${ages.length ? ages[0].toFixed(0) + '/' + median(ages).toFixed(0) + '/' + ages[ages.length - 1].toFixed(0) + 'm' : 'n/a'}`,
    `Hyperliquid assets parsed: ${snapshot.hl ? Object.keys(snapshot.hl).length : 0} | Kraken dated contracts parsed: ${Array.isArray(snapshot.dated) ? snapshot.dated.length : 0}`
  ];
  if (errs.length) healthLines.push('Errors: ' + escHtml(errs.join(', ')));
  const pad = (s, n) => { s = String(s); return s.length < n ? s + ' '.repeat(n - s.length) : s.slice(0, n); };
  const tbl = [pad('ASSET', 6) + pad('PRICE', 12) + pad('NOW/d', 9) + pad('24h/d', 9) + pad('7d/d', 9) + pad('SIGN7d', 7) + 'AGEm'];
  for (const h of health) {
    const s = h.st;
    tbl.push(pad(h.asset, 6) + pad(h.price > 0 ? '$' + h.price.toFixed(4) : 'n/a', 12) +
      pad(s ? pct(s.dailyNow) : 'n/a', 9) + pad(s ? pct(s.daily24) : 'n/a', 9) + pad(s ? pct(s.daily7d) : 'n/a', 9) +
      pad(s ? (s.sameSignFrac7d * 100).toFixed(0) + '%' : 'n/a', 7) + (s ? s.ageMin.toFixed(0) : 'n/a'));
  }
  const healthPrices = '<b>DSFAB — Funding table (per day)</b>\n<pre>' + escHtml(tbl.join('\n')) + '</pre>';

  // Alert: judged under alertScenario only
  const cand = results.filter((r) => r.pass && r.scenario === cfg.alertScenario && (cfg.alertOnExperimental || !r.experimental))
    .sort((a, b) => b.netUsd - a.netUsd);
  let alert = null;
  if (cand.length) {
    const b = cand[0];
    alert = [
      `✅ <b>DSFAB PICK</b> (${escHtml(cfg.alertScenario)} costs)`,
      `${escHtml(b.symbol || b.asset)} — ${DIR_TEXT[b.direction]}`,
      b.strategy === 'datedBasis'
        ? `basis ${pct(b.basis, 2)} over ${b.daysToExpiry.toFixed(0)}d`
        : `expected ${pct(Math.abs(b.expectedDaily))}/day | breakeven ${days(b.breakevenDays)}`,
      `net over ${b.strategy === 'datedBasis' ? 'expiry' : cfg.holdDays + 'd'}: $${b.netUsd.toFixed(2)} on $${b.notional.toFixed(0)} notional`,
      b.validUntilMs ? `Funding print valid until ${new Date(b.validUntilMs).toISOString()} (≈ ${fmtRemain(b.remainMin)})` : ''
    ].filter(Boolean).join('\n');
  }

  const rows = results.map((r) => ({
    timestamp: ts, strategy: r.strategy, scenario: r.scenario, asset: r.asset, symbol: r.symbol || '',
    spotPrice: r.spotPrice, direction: r.direction, executable: !!r.executable, pass: !!r.pass,
    reasons: r.reasons.join('; '),
    expectedDailyPct: +(r.expectedDaily * 100).toFixed(6),
    daily24Pct: r.daily24 === undefined || r.daily24 === null ? '' : +(r.daily24 * 100).toFixed(6),
    daily7dPct: r.daily7d === undefined || r.daily7d === null ? '' : +(r.daily7d * 100).toFixed(6),
    sameSignFrac7d: r.sameSignFrac7d === undefined ? '' : +r.sameSignFrac7d.toFixed(3),
    roundTripCostPct: +(r.roundTripCost * 100).toFixed(4),
    breakevenDays: Number.isFinite(r.breakevenDays) ? +r.breakevenDays.toFixed(2) : '',
    netOverHoldPct: +(r.netOverHold * 100).toFixed(4),
    netUsd: +r.netUsd.toFixed(4),
    annualOnCapitalPct: Number.isFinite(r.annualOnCapital) ? +(r.annualOnCapital * 100).toFixed(3) : '',
    notional: +r.notional.toFixed(2),
    ageMin: r.ageMin === undefined ? '' : +r.ageMin.toFixed(1),
    fresh: r.fresh === undefined ? '' : !!r.fresh,
    validUntil: r.validUntilMs ? new Date(r.validUntilMs).toISOString() : ''
  }));

  return {
    message: truncateHtml(lines.join('\n')),
    health: truncateHtml(healthLines.join('\n')),
    healthPrices: truncateHtml(healthPrices),
    alert, rows, results
  };
}

const DSFAB = {
  num, toMs, mean, median, defaultConfig, mergeConfig, parseKrakenFunding, fundingStats, costModel,
  sizing, evaluate, analyzeCarry, parseHyperliquid, analyzePerpPerp, parseKrakenDated, analyzeBasis,
  analyzeSnapshot, buildReport, truncateHtml
};
// --- exports (everything below this line is stripped in the n8n build) ---
module.exports = DSFAB;
