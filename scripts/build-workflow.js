#!/usr/bin/env node
/* Build workflow/dsfab_process3.json from src/. Run after any change in src/: npm run build */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('../src/core');
const assets = require('../src/assets');

const root = path.join(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8').split('// --- exports')[0];
const nodeSrc = (f) => fs.readFileSync(path.join(root, 'src/nodes', f), 'utf8').replace('/*__CORE__*/', () => coreSrc);
const id = (name) => { const h = crypto.createHash('sha1').update(name).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

const nodes = [];
const connections = {};
const add = (name, type, typeVersion, position, parameters, extra) => { nodes.push(Object.assign({ parameters, id: id(name), name, type, typeVersion, position }, extra || {})); return name; };
const link = (from, ...to) => { connections[from] = { main: [to.map((node) => ({ node, type: 'main', index: 0 }))] }; };
const code = (name, pos, jsCode) => add(name, 'n8n-nodes-base.code', 1, pos, { language: 'JavaScript', jsCode });
const http = (name, pos, parameters, extra) => add(name, 'n8n-nodes-base.httpRequest', 4, pos, Object.assign({ options: { timeout: 15000 } }, parameters), Object.assign({ alwaysOutputData: true, onError: 'continueRegularOutput' }, extra || {}));
const telegram = (name, pos, field) => add(name, 'n8n-nodes-base.telegram', 1, pos, { chatId: 'YOUR_CHAT_ID', text: `={{ $json.${field} }}`, additionalFields: { parse_mode: 'HTML' } }, { credentials: { telegramApi: { id: 'YOUR_TELEGRAM_CREDENTIAL_ID', name: 'Telegram account' } } });

const cron = add('Cron (every 15m)', 'n8n-nodes-base.cron', 1, [-2000, 496], { triggerTimes: { item: [{ mode: 'everyX', value: 15, unit: 'minutes' }] } });
const cfg = code('Scenario Configs', [-1820, 496], `/* Scenario Configs — edit values here; logic lives in the other nodes.\n * Fees are PER LEG, as fractions of notional (0.006 = 0.60%). Set them to your own fee tier. */\nconst config = ${JSON.stringify(core.defaultConfig(), null, 2)};\nreturn [{ json: config }];`);
const assetsNode = code('Assets Config', [-1640, 496], `/* Asset universe. Set enabled:false to exclude an asset. */\nconst assets = ${JSON.stringify(assets, null, 2)};\nreturn assets.filter((a) => a.enabled).map((a) => ({ json: a }));`);
const cb = http('CB — Spot Price', [-1460, 496], { url: "={{ 'https://api.exchange.coinbase.com/products/' + $json.cb + '/ticker' }}" });
const kr = http('KR — Funding History', [-1280, 496], { url: "={{ 'https://futures.kraken.com/derivatives/api/v3/historical-funding-rates?symbol=' + $('Assets Config').all()[$itemIndex].json.kr }}" });
const krT = http('KR — Tickers', [-1100, 496], { url: 'https://futures.kraken.com/derivatives/api/v3/tickers' }, { executeOnce: true });
const hl = http('HL — Funding Snapshot', [-920, 496], { method: 'POST', url: 'https://api.hyperliquid.xyz/info', sendBody: true, specifyBody: 'json', jsonBody: '{"type":"metaAndAssetCtxs"}' }, { executeOnce: true });
const assemble = code('Assemble Snapshot', [-740, 496], nodeSrc('assemble.js'));
const analyze = code('Analyze & Advise', [-560, 496], nodeSrc('analyze.js'));
const tgReport = telegram('Telegram — Report', [-340, 336], 'message');
const tgHealth = telegram('Telegram — Health', [-340, 176], 'health');
const tgTable = telegram('Telegram — Funding Table', [-340, 16], 'healthPrices');
const alert = code('Build Alert (if any)', [-340, 656], '// Emits nothing when there is no alert, so the Telegram node does not run.\nconst a = $input.first().json.alert;\nif (!a) return [];\nreturn [{ json: { message: a } }];');
const tgAlert = telegram('Telegram — Alert', [-160, 656], 'message');
const rows = code('Rows → Items', [-340, 816], 'const rows = $input.first().json.rows;\nreturn (Array.isArray(rows) ? rows : []).map((r) => ({ json: r }));');
const sheets = add('Google Sheets — Append', 'n8n-nodes-base.googleSheets', 4, [-160, 816], {
  operation: 'append',
  documentId: { __rl: true, value: 'YOUR_SHEET_ID', mode: 'id' },
  sheetName: { __rl: true, value: 'DSFAB_Logs', mode: 'name' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {}
});

link(cron, cfg); link(cfg, assetsNode); link(assetsNode, cb); link(cb, kr); link(kr, krT); link(krT, hl); link(hl, assemble);
link(assemble, analyze); link(analyze, tgReport, tgHealth, tgTable, alert, rows); link(alert, tgAlert); link(rows, sheets);

const wf = { name: 'DSFAB Process 3 — delta-neutral radar', nodes, connections, active: false, settings: { executionOrder: 'v1' }, tags: [] };
const out = path.join(root, 'workflow/dsfab_process3.json');
fs.writeFileSync(out, JSON.stringify(wf, null, 2) + '\n');
console.log(`wrote ${path.relative(root, out)} (${nodes.length} nodes)`);
