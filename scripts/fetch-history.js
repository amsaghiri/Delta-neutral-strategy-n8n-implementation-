#!/usr/bin/env node
/* Download Kraken Futures funding history for every enabled asset into data/<SYMBOL>.json.
 * Read-only public endpoint. Usage: node scripts/fetch-history.js [outDir] */
const fs = require('fs');
const path = require('path');
const assets = require('../src/assets').filter((a) => a.enabled);

(async () => {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data'));
  fs.mkdirSync(out, { recursive: true });
  for (const a of assets) {
    const url = 'https://futures.kraken.com/derivatives/api/v3/historical-funding-rates?symbol=' + a.kr;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      fs.writeFileSync(path.join(out, a.kr + '.json'), JSON.stringify(body));
      console.log(`${a.kr}: ${(body.rates || []).length} prints`);
    } catch (e) {
      console.log(`${a.kr}: FAILED (${e.message})`);
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite to the API
  }
})();
