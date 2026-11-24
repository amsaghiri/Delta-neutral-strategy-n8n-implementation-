/* Assemble one snapshot from all fetch nodes. Responses are matched to assets by index. */
/*__CORE__*/
const list = $('Assets Config').all().map((i) => i.json);
const cbAll = $('CB — Spot Price').all();
const krAll = $('KR — Funding History').all();
let userCfg = {};
try { userCfg = $('Scenario Configs').first().json || {}; } catch (_) {}
const C = mergeConfig(userCfg);
const KEEP_POINTS = 800; // ~33 days of hourly prints; keeps execution data small
const bodyOf = (it) => {
  const j = it && it.json !== undefined ? it.json : it;
  return j && j.body !== undefined && j.statusCode !== undefined ? j.body : j;
};

const assets = list.map((meta, i) => {
  const errors = [];
  const cb = bodyOf(cbAll[i]) || {};
  let price = null;
  for (const k of ['price', 'last', 'ask', 'bid']) { price = num(cb[k]); if (price !== null) break; }
  if (price === null) errors.push(cb.error || cb.message ? 'cb_error' : 'cb_no_price');
  const kr = parseKrakenFunding(bodyOf(krAll[i]), C.sanity);
  if (!kr.ok) errors.push(kr.reason);
  kr.series = kr.series.slice(-KEEP_POINTS);
  return { asset: meta.asset, hlName: meta.hl || meta.asset, price: price === null ? 0 : price, kr, errors };
});

// Hyperliquid answers with a top-level array [meta, assetCtxs]; n8n may split it into two items.
let hlByName = {};
try {
  const items = $('HL — Funding Snapshot').all().map(bodyOf);
  let body = items;
  if (items.length === 1 && Array.isArray(items[0])) body = items[0];
  if (body.length >= 2 && body[1] && !Array.isArray(body[1])) body = [body[0], Object.values(body[1])];
  hlByName = parseHyperliquid(body, C.sanity);
} catch (_) {}
const hl = {};
for (const a of assets) if (hlByName[String(a.hlName).toUpperCase()]) hl[a.asset] = hlByName[String(a.hlName).toUpperCase()];

let dated = [];
try {
  const known = new Set(assets.map((a) => a.asset));
  dated = parseKrakenDated(bodyOf($('KR — Tickers').first())).filter((c) => known.has(c.asset));
} catch (_) {}

return [{ json: { timestamp: new Date().toISOString(), assets, hl, dated } }];
