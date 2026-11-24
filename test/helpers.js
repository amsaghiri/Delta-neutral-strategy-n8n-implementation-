const H = 3600000;
/* Build a Kraken-shaped funding body: `hours` hourly prints ending at `endMs`, rate from fn(i). */
function krakenBody(hours, endMs, fn) {
  const rates = [];
  for (let i = 0; i < hours; i++) {
    const rel = fn(i);
    rates.push({ timestamp: new Date(endMs - (hours - 1 - i) * H).toISOString(), fundingRate: rel * 91000, relativeFundingRate: rel });
  }
  return { result: 'success', serverTime: new Date(endMs).toISOString(), rates };
}
module.exports = { H, krakenBody };
