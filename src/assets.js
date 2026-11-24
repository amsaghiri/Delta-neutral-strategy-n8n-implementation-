/* Asset universe: Coinbase spot (USD), Kraken Futures linear perp (PF_*), Hyperliquid perp name.
 * Set enabled:false to exclude an asset. The health report lists any symbol a venue rejects. */
module.exports = [
  { asset: 'BTC', cb: 'BTC-USD', kr: 'PF_XBTUSD', hl: 'BTC', enabled: true },
  { asset: 'ETH', cb: 'ETH-USD', kr: 'PF_ETHUSD', hl: 'ETH', enabled: true },
  { asset: 'SOL', cb: 'SOL-USD', kr: 'PF_SOLUSD', hl: 'SOL', enabled: true },
  { asset: 'XRP', cb: 'XRP-USD', kr: 'PF_XRPUSD', hl: 'XRP', enabled: true },
  { asset: 'ADA', cb: 'ADA-USD', kr: 'PF_ADAUSD', hl: 'ADA', enabled: true },
  { asset: 'DOGE', cb: 'DOGE-USD', kr: 'PF_DOGEUSD', hl: 'DOGE', enabled: true },
  { asset: 'DOT', cb: 'DOT-USD', kr: 'PF_DOTUSD', hl: 'DOT', enabled: true },
  { asset: 'LINK', cb: 'LINK-USD', kr: 'PF_LINKUSD', hl: 'LINK', enabled: true },
  { asset: 'LTC', cb: 'LTC-USD', kr: 'PF_LTCUSD', hl: 'LTC', enabled: true },
  { asset: 'BCH', cb: 'BCH-USD', kr: 'PF_BCHUSD', hl: 'BCH', enabled: true },
  { asset: 'AVAX', cb: 'AVAX-USD', kr: 'PF_AVAXUSD', hl: 'AVAX', enabled: true },
  { asset: 'MATIC', cb: 'MATIC-USD', kr: 'PF_MATICUSD', hl: 'POL', enabled: true },
  { asset: 'ATOM', cb: 'ATOM-USD', kr: 'PF_ATOMUSD', hl: 'ATOM', enabled: true },
  { asset: 'XLM', cb: 'XLM-USD', kr: 'PF_XLMUSD', hl: 'XLM', enabled: true },
  { asset: 'UNI', cb: 'UNI-USD', kr: 'PF_UNIUSD', hl: 'UNI', enabled: true },
  { asset: 'ETC', cb: 'ETC-USD', kr: 'PF_ETCUSD', hl: 'ETC', enabled: true },
  { asset: 'FIL', cb: 'FIL-USD', kr: 'PF_FILUSD', hl: 'FIL', enabled: true },
  { asset: 'ALGO', cb: 'ALGO-USD', kr: 'PF_ALGOUSD', hl: 'ALGO', enabled: true },
  { asset: 'AAVE', cb: 'AAVE-USD', kr: 'PF_AAVEUSD', hl: 'AAVE', enabled: true },
  { asset: 'NEAR', cb: 'NEAR-USD', kr: 'PF_NEARUSD', hl: 'NEAR', enabled: true }
];
