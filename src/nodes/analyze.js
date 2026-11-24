/* Analyze the snapshot: funding carry, perp-perp spread, dated basis; build reports, alert and log rows. */
/*__CORE__*/
const snap = $input.first().json;
let userCfg = {};
try { userCfg = $('Scenario Configs').first().json || {}; } catch (_) {}
const out = buildReport(snap, userCfg, Date.now(), $workflow.name);
return [{ json: { message: out.message, health: out.health, healthPrices: out.healthPrices, alert: out.alert, rows: out.rows } }];
