const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { krakenBody } = require('./helpers');

const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflow', 'dsfab_process3.json'), 'utf8'));
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

test('workflow is strict JSON with unique node names/ids and valid connections', () => {
  assert.equal(new Set(wf.nodes.map((n) => n.name)).size, wf.nodes.length);
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length);
  for (const [from, c] of Object.entries(wf.connections)) {
    assert.ok(byName[from], 'unknown source ' + from);
    for (const t of c.main[0]) assert.ok(byName[t.node], 'unknown target ' + t.node);
  }
  const reachable = new Set(Object.values(wf.connections).flatMap((c) => c.main[0].map((t) => t.node)));
  for (const n of wf.nodes) if (n.type !== 'n8n-nodes-base.cron') assert.ok(reachable.has(n.name), n.name + ' is not connected');
});

test('no secrets, only placeholders', () => {
  const raw = JSON.stringify(wf);
  assert.ok(!/bot\d{6,}:[A-Za-z0-9_-]{20,}/.test(raw));
  assert.match(raw, /YOUR_CHAT_ID/);
  assert.match(raw, /YOUR_SHEET_ID/);
});

test('every $(\'...\') reference in code and expressions names an existing node', () => {
  const raw = wf.nodes.map((n) => JSON.stringify(n.parameters)).join('\n');
  const refs = [...raw.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length > 3);
  for (const r of refs) assert.ok(byName[r], 'reference to missing node: ' + r);
});

/* Run the Code-node bodies end to end with mocked n8n globals. */
function runNode(name, ctx) {
  const body = byName[name].parameters.jsCode;
  const $ = (n) => ({ all: () => ctx[n] || [], first: () => (ctx[n] || [])[0] });
  const fn = new Function('$', '$input', '$workflow', body);
  return fn($, { first: () => ctx.__input[0], all: () => ctx.__input }, { name: 'test-wf' });
}

test('code nodes run end to end on mocked exchange responses', () => {
  const now = Date.now();
  const end = now - 20 * 60000;
  const ctx = {};
  ctx['Scenario Configs'] = (ctx.__input = [], runNode('Scenario Configs', ctx));
  ctx['Assets Config'] = runNode('Assets Config', ctx);
  assert.equal(ctx['Assets Config'].length, 20);
  ctx['CB — Spot Price'] = ctx['Assets Config'].map((a, i) => ({ json: i === 3 ? { error: { message: 'NotFound' } } : { price: String(100 + i), bid: '1', ask: '2' } }));
  ctx['KR — Funding History'] = ctx['Assets Config'].map((a, i) => ({ json: i === 4 ? { result: 'error', error: 'x' } : krakenBody(400, end, () => (i === 0 ? 0.0001 : i === 1 ? -0.0002 : 0.00001)) }));
  ctx['KR — Tickers'] = [{ json: { result: 'success', tickers: [{ symbol: 'FF_XBTUSD_' + new Date(now + 40 * 86400000).toISOString().slice(2, 10).replace(/-/g, ''), bid: 103.5, indexPrice: 100 }] } }];
  // n8n may deliver the Hyperliquid array as two items
  ctx['HL — Funding Snapshot'] = [{ json: { universe: [{ name: 'BTC' }, { name: 'ETH' }] } }, { json: [{ funding: '0.00002', markPx: '100.2' }, { funding: '0.0001', markPx: '101.1' }] }];

  ctx.__input = ctx['HL — Funding Snapshot'];
  const snap = runNode('Assemble Snapshot', ctx);
  assert.equal(snap.length, 1);
  const s = snap[0].json;
  assert.equal(s.assets.length, 20);
  assert.deepEqual(s.assets[3].errors, ['cb_error']);
  assert.deepEqual(s.assets[4].errors, ['kr_no_rates']);
  assert.deepEqual(Object.keys(s.hl), ['BTC', 'ETH']);
  assert.equal(s.dated.length, 1);
  JSON.parse(JSON.stringify(s)); // must survive n8n item serialisation

  ctx.__input = JSON.parse(JSON.stringify(snap));
  const out = runNode('Analyze & Advise', ctx)[0].json;
  for (const k of ['message', 'health', 'healthPrices']) { assert.equal(typeof out[k], 'string'); assert.ok(out[k].length > 20 && out[k].length <= 4096); }
  assert.match(out.message, /Funding carry/);
  assert.match(out.health, /Hyperliquid assets parsed: 2/);
  assert.match(out.health, /XRP\(cb_error\)/);
  assert.match(out.alert, /BTC — Short perp \(KR\) \+ Long spot \(CB\)/);
  const eth = out.rows.find((r) => r.asset === 'ETH' && r.strategy === 'fundingCarry' && r.scenario === 'Base');
  assert.equal(eth.pass, false);
  assert.match(eth.reasons, /needs spot short/);
  const ethPP = out.rows.find((r) => r.asset === 'ETH' && r.strategy === 'perpPerpSpread' && r.scenario === 'Base');
  assert.equal(ethPP.direction, 'LONG_KRAKEN_SHORT_HL');
  assert.ok(out.rows.some((r) => r.strategy === 'datedBasis' && r.pass));

  ctx.__input = [{ json: out }];
  assert.equal(runNode('Build Alert (if any)', ctx).length, 1);
  assert.equal(runNode('Rows → Items', ctx).length, out.rows.length);
  ctx.__input = [{ json: { alert: null } }];
  assert.equal(runNode('Build Alert (if any)', ctx).length, 0);
});
