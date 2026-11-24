const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core');
const { runBacktest } = require('../src/backtest');
const { krakenBody } = require('./helpers');
const END = Date.UTC(2026, 10, 23, 12, 0);
const base = core.defaultConfig().scenarios.find((s) => s.name === 'Base');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('constant high funding: one trade, net = funding earned - one round trip', () => {
  const rel = 0.0001;
  const k = core.parseKrakenFunding(krakenBody(1000, END, () => rel));
  const r = runBacktest(k.series, 60, base, {});
  assert.equal(r.trades, 1);
  assert.equal(r.periods, 880);
  near(r.grossFunding, rel * 880);
  near(r.net, rel * 880 - core.costModel(base).carryRoundTrip);
  near(r.timeInMarket, 1);
});

test('typical low funding: the rule stays flat instead of paying costs', () => {
  const k = core.parseKrakenFunding(krakenBody(1000, END, () => 0.00001));
  const r = runBacktest(k.series, 60, base, {});
  assert.equal(r.trades, 0);
  assert.equal(r.net, 0);
  assert.ok(r.alwaysInNet < 0); // always-in would have lost money after costs
});

test('regime flip: the position is closed and no look-ahead is used', () => {
  const k = core.parseKrakenFunding(krakenBody(1000, END, (i) => (i < 600 ? 0.0001 : -0.0001)));
  const r = runBacktest(k.series, 60, base, {});
  assert.equal(r.trades, 1);
  assert.ok(r.timeInMarket < 0.62 && r.timeInMarket > 0.5);
  assert.ok(r.grossFunding < 0.0001 * 480); // it pays some negative prints before the exit rule fires
});
