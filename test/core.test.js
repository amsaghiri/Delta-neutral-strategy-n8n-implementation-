const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core');
const { H, krakenBody } = require('./helpers');

const NOW = Date.UTC(2026, 10, 23, 12, 30);
const END = Date.UTC(2026, 10, 23, 12, 0);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const base = core.defaultConfig().scenarios.find((s) => s.name === 'Base');

test('real Kraken rows: the relative rate is used, never the absolute fundingRate', () => {
  // First rows returned by the live API for PF_XBTUSD (fetched 2026-11-24).
  const body = { rates: [
    { timestamp: '2025-11-19T09:00:00Z', fundingRate: 1.07059350853083229, relativeFundingRate: 0.000011712968055556 },
    { timestamp: '2025-11-19T10:00:00Z', fundingRate: 0.862080862722665644, relativeFundingRate: 0.000009426968055556 },
    { timestamp: '2025-11-19T11:00:00Z', fundingRate: 0.544556755272596113, relativeFundingRate: 0.000005967455555556 }
  ] };
  const k = core.parseKrakenFunding(body);
  assert.equal(k.ok, true);
  assert.equal(k.cadenceMin, 60);
  near(k.series[2].rel, 0.000005967455555556);
  const st = core.fundingStats(k.series, k.cadenceMin, Date.parse('2025-11-19T11:30:00Z'));
  near(st.dailyNow, 0.000005967455555556 * 24); // hourly print -> x24, not x3
  near(st.ageMin, 30);
});

test('unsorted input and insane rates are handled', () => {
  const k = core.parseKrakenFunding({ rates: [
    { timestamp: '2026-01-01T02:00:00Z', relativeFundingRate: 0.00002 },
    { timestamp: '2026-01-01T01:00:00Z', relativeFundingRate: 0.5 },
    { timestamp: '2026-01-01T00:00:00Z', relativeFundingRate: 0.00001 }
  ] });
  assert.equal(k.series.length, 2);
  assert.ok(k.series[0].t < k.series[1].t);
  assert.equal(core.parseKrakenFunding({}).ok, false);
  assert.equal(core.parseKrakenFunding({ rates: [{ timestamp: 'x', fundingRate: 1 }] }).ok, false);
});

test('cost model counts four fills', () => {
  const c = core.costModel({ spotFee: 0.006, spotSlippage: 0.0005, perpFee: 0.0005, perpSlippage: 0.0005 });
  near(c.carryRoundTrip, 2 * 0.0065 + 2 * 0.001);
  near(c.perpPerpRoundTrip, 4 * 0.001);
  near(c.basisRoundTrip, 2 * 0.0065 + 0.001);
});

test('sizing splits capital between spot leg and perp margin', () => {
  const s = core.sizing({ capitalUSD: 600, perpMarginFraction: 0.5 });
  near(s.notional, 400);
  near(s.perpMarginUSD, 200);
  near(core.sizing({ capitalUSD: 600, perpMarginFraction: 0.5 }, true).notional, 600);
});

test('steady positive funding passes; breakeven = cost / daily', () => {
  const rel = 0.0001; // 0.24%/day, far above normal: chosen so Base costs clear
  const k = core.parseKrakenFunding(krakenBody(400, END, () => rel));
  const st = core.fundingStats(k.series, 60, NOW);
  const cfg = core.defaultConfig();
  const r = core.analyzeCarry('BTC', 60000, st, base, cfg, true);
  assert.equal(r.direction, 'SHORT_PERP_LONG_SPOT');
  near(r.expectedDaily, rel * 24);
  near(r.breakevenDays, core.costModel(base).carryRoundTrip / (rel * 24));
  near(r.netOverHold, rel * 24 * 30 - core.costModel(base).carryRoundTrip);
  assert.equal(r.pass, true);
});

test('typical funding (about 10%/yr) does NOT pass at retail costs', () => {
  const k = core.parseKrakenFunding(krakenBody(400, END, () => 0.0000117));
  const st = core.fundingStats(k.series, 60, NOW);
  const r = core.analyzeCarry('BTC', 60000, st, base, core.defaultConfig(), true);
  assert.equal(r.pass, false);
  assert.ok(r.breakevenDays > 40);
  assert.ok(r.reasons.includes('breakeven too long'));
});

test('negative funding is flagged as needing a spot short', () => {
  const k = core.parseKrakenFunding(krakenBody(400, END, () => -0.0002));
  const st = core.fundingStats(k.series, 60, NOW);
  const cfg = core.defaultConfig();
  const r = core.analyzeCarry('BTC', 60000, st, base, cfg, true);
  assert.equal(r.direction, 'LONG_PERP_SHORT_SPOT');
  assert.equal(r.executable, false);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.includes('needs spot short'));
  const r2 = core.analyzeCarry('BTC', 60000, st, base, Object.assign({}, cfg, { allowSpotShort: true }), true);
  assert.equal(r2.executable, true);
  near(r2.expectedDaily, -0.0002 * 24);
});

test('a sign flip in the last 24h zeroes the expectation', () => {
  const k = core.parseKrakenFunding(krakenBody(400, END, (i) => (i >= 376 ? -0.0001 : 0.0001)));
  const st = core.fundingStats(k.series, 60, NOW);
  assert.equal(st.expectedDaily, 0);
  const r = core.analyzeCarry('BTC', 60000, st, base, core.defaultConfig(), true);
  assert.equal(r.direction, 'NONE');
  assert.equal(r.pass, false);
});

test('noisy sign fails the persistence filter', () => {
  const k = core.parseKrakenFunding(krakenBody(400, END, (i) => (i % 2 ? 0.0005 : -0.0003)));
  const st = core.fundingStats(k.series, 60, NOW);
  near(st.sameSignFrac7d, 0.5);
  const r = core.analyzeCarry('BTC', 60000, st, base, core.defaultConfig(), true);
  assert.ok(r.reasons.includes('unstable sign'));
});

test('perp-perp spread: direction and Hyperliquid parsing', () => {
  const hl = core.parseHyperliquid([
    { universe: [{ name: 'BTC' }, { name: 'ETH' }, { name: 'BAD' }] },
    [{ funding: '-0.0001', markPx: '60100' }, { funding: '0.00001', oraclePx: '1700' }, { funding: '0.9', markPx: '1' }]
  ]);
  assert.deepEqual(Object.keys(hl), ['BTC', 'ETH']);
  near(hl.BTC.hourly, -0.0001);
  const k = core.parseKrakenFunding(krakenBody(400, END, () => 0.0001));
  const st = core.fundingStats(k.series, 60, NOW);
  const cfg = core.defaultConfig();
  const r = core.analyzePerpPerp('BTC', 60000, st, hl.BTC, base, cfg, true);
  assert.equal(r.direction, 'SHORT_KRAKEN_LONG_HL');
  near(r.expectedDaily, 0.0002 * 24);
  assert.equal(r.pass, true);
  const gap = core.analyzePerpPerp('BTC', 50000, st, hl.BTC, base, cfg, true);
  assert.ok(gap.reasons.includes('venue price gap'));
});

test('dated basis: symbol parsing and annualisation', () => {
  const now = Date.UTC(2026, 10, 23, 12, 0);
  const dated = core.parseKrakenDated({ tickers: [
    { symbol: 'PF_XBTUSD', markPrice: 60000 },
    { symbol: 'FF_XBTUSD_261225', bid: 61800, markPrice: 61850, indexPrice: 60010 },
    { symbol: 'FI_ETHUSD_261225', markPrice: 1750 }
  ] });
  assert.equal(dated.length, 2);
  assert.equal(dated[0].asset, 'BTC');
  assert.equal(dated[0].price, 61800);
  assert.equal(dated[0].expiryMs, Date.UTC(2026, 11, 25, 12, 0));
  const cfg = core.defaultConfig();
  const r = core.analyzeBasis(dated[0], 60000, base, cfg, now);
  near(r.basis, 0.03);
  near(r.daysToExpiry, 32);
  near(r.netOverHold, 0.03 - core.costModel(base).basisRoundTrip);
  near(r.annualOnCapital, (r.netOverHold * (500 / 1.5) / 500) * (365 / 32));
  assert.equal(r.pass, true);
  assert.ok(core.analyzeBasis(dated[1], 1700, base, cfg, now).reasons.includes('inverse contract'));
  assert.ok(core.analyzeBasis(dated[0], 62500, base, cfg, now).reasons.includes('needs spot short'));
});

test('alerts are judged under alertScenario, not the cheapest scenario', () => {
  // 0.00003/h = 0.072%/day: breakeven is 12.8 days at Maker costs (0.92%) but 20.8 days at Base (1.50%)
  const rel = 0.00003;
  const snap = { timestamp: '', hl: {}, dated: [], assets: [{ asset: 'BTC', price: 60000, kr: core.parseKrakenFunding(krakenBody(400, END, () => rel)), errors: [] }] };
  const cfg = core.mergeConfig({ strategies: { perpPerpSpread: false, datedBasis: false } });
  const out = core.buildReport(snap, cfg, NOW, 'wf');
  const maker = out.results.find((r) => r.scenario === 'Maker');
  const b = out.results.find((r) => r.scenario === 'Base');
  assert.equal(maker.pass, true);
  assert.equal(b.pass, false);
  assert.equal(out.alert, null);
  const out2 = core.buildReport(snap, Object.assign({}, cfg, { alertScenario: 'Maker' }), NOW, 'wf');
  assert.match(out2.alert, /DSFAB PICK/);
});

test('stale prints are excluded and reported', () => {
  const snap = { timestamp: '', hl: {}, dated: [], assets: [{ asset: 'BTC', price: 60000, kr: core.parseKrakenFunding(krakenBody(400, END - 6 * H, () => 0.0002)), errors: [] }] };
  const out = core.buildReport(snap, {}, NOW, 'wf');
  assert.ok(out.results.filter((r) => r.strategy === 'fundingCarry').every((r) => !r.pass && r.reasons.includes('stale')));
});

test('truncateHtml cuts on a line boundary and closes <pre>', () => {
  const msg = '<b>t</b>\n<pre>' + Array.from({ length: 400 }, (_, i) => 'row ' + i + ' xxxxxxxxxxxxxxxx').join('\n') + '</pre>';
  const out = core.truncateHtml(msg, 1000);
  assert.ok(out.length <= 1000);
  assert.equal((out.match(/<pre>/g) || []).length, (out.match(/<\/pre>/g) || []).length);
  assert.match(out, /truncated/);
});

test('mergeConfig keeps defaults for missing nested keys', () => {
  const c = core.mergeConfig({ policy: { maxBreakevenDays: 5 }, scenarios: [] });
  assert.equal(c.policy.maxBreakevenDays, 5);
  assert.equal(c.policy.minSameSignFrac, 0.7);
  assert.equal(c.scenarios.length, 3);
});
