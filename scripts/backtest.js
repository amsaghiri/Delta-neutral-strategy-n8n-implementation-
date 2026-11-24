#!/usr/bin/env node
/* Backtest the funding-carry rule on downloaded history.
 * Usage: node scripts/backtest.js [dataDir] [--scenario Base] [--capital 500] [--allow-spot-short] */
const fs = require('fs');
const path = require('path');
const core = require('../src/core');
const { runBacktest } = require('../src/backtest');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const dir = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, '..', 'data'));
const cfg = core.mergeConfig({ capitalUSD: +opt('--capital', 500), allowSpotShort: args.includes('--allow-spot-short') });
const sc = cfg.scenarios.find((s) => s.name === opt('--scenario', 'Base')) || cfg.scenarios[0];

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
if (!files.length) { console.error(`No history in ${dir}. Run: node scripts/fetch-history.js`); process.exit(1); }
const p = (v) => (v * 100).toFixed(2).padStart(8) + '%';
console.log(`Scenario ${sc.name} | round-trip cost ${(core.costModel(sc).carryRoundTrip * 100).toFixed(2)}% | capital $${cfg.capitalUSD} | spot short ${cfg.allowSpotShort ? 'allowed' : 'not allowed'}`);
console.log('SYMBOL'.padEnd(13) + 'DAYS'.padStart(6) + 'TRADES'.padStart(7) + 'IN-MKT'.padStart(8) + 'GROSS'.padStart(9) + 'COSTS'.padStart(9) + 'NET'.padStart(9) + 'NET/yr*'.padStart(9) + 'ALWAYS-IN/yr*'.padStart(15));
let totalUsd = 0;
for (const f of files) {
  const k = core.parseKrakenFunding(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), cfg.sanity);
  if (!k.ok) { console.log(f.replace('.json', '').padEnd(13) + ' ' + k.reason); continue; }
  const r = runBacktest(k.series, k.cadenceMin, sc, cfg);
  totalUsd += r.netUsd;
  console.log(f.replace('.json', '').padEnd(13) + r.spanDays.toFixed(0).padStart(6) + String(r.trades).padStart(7) + p(r.timeInMarket) + p(r.grossFunding) + p(r.costs) + p(r.net) + p(r.annualOnCapital) + p(r.alwaysInAnnualOnCapital).padStart(15));
}
console.log(`\n* annualised on total capital. Sum of net over the sample if each asset ran alone on $${cfg.capitalUSD}: $${totalUsd.toFixed(2)}`);
console.log('Funding and trading costs only. Not modelled: basis moves, margin calls, liquidation, withdrawal fees, taxes.');
