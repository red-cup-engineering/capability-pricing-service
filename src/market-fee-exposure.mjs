/**
 * Analyze fee-floor exposure in an observed seller catalog.
 * This tool does not change prices, pay, settle, or assert actual margin.
 * USD amounts have exact six-decimal precision rather than floating point.
 */
function micros(value, label, allowZero = false) {
  if (typeof value !== 'string' || !/^\$?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u.test(value))
    throw new Error(label + ' must be an exact USD decimal string (<=6 places)');
  const parts = value.replace(/^\$/u, '').split('.');
  const amount = BigInt(parts[0]) * 1000000n + BigInt((parts[1] || '').padEnd(6, '0') || '0');
  if (!allowZero && amount === 0n) throw new Error(label + ' must be positive');
  return amount;
}
function dollars(amount) {
  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 1000000n;
  const fraction = String(absolute % 1000000n).padStart(6, '0').replace(/0+$/u, '');
  return sign + String(whole) + (fraction ? '.' + fraction : '');
}
export function assessMarketFeeExposure({offers, feeScenarios, sourceReceipt}) {
  if (typeof sourceReceipt !== 'string' || !sourceReceipt.trim())
    throw new Error('sourceReceipt required; an old catalog is not live proof');
  if (!Array.isArray(offers)) throw new Error('offers must be an array');
  if (!Array.isArray(feeScenarios) || feeScenarios.length === 0)
    throw new Error('at least one explicitly labeled fee scenario required');
  const seen = new Set();
  const rows = offers.map((offer, i) => {
    const route = offer?.route;
    if (typeof route !== 'string' || !route.startsWith('/') || route.includes('..'))
      throw new Error('offers[' + i + '].route invalid');
    if (seen.has(route)) throw new Error('duplicate offered route ' + route);
    seen.add(route);
    const price = offer.price === null || offer.price === undefined
      ? null : micros(offer.price, 'offers[' + i + '].price');
    return {route, gateway: offer.gateway ?? null, price};
  });
  const scenarios = feeScenarios.map((scenario, i) => {
    if (typeof scenario?.name !== 'string' || !scenario.name.trim())
      throw new Error('feeScenarios[' + i + '].name required');
    const fixed = micros(scenario.flatFeeUsd, 'feeScenarios[' + i + '].flatFeeUsd', true);
    const bps = scenario.percentBps ?? 0;
    if (!Number.isInteger(bps) || bps < 0 || bps > 10000)
      throw new Error('feeScenarios[' + i + '].percentBps must be integer 0..10000');
    let atRisk = 0;
    const observations = rows.map(({route, gateway, price}) => {
      if (price === null) return {route, gateway, priceUsd:null, status:'unquotable-price-unknown'};
      const percentage = (price * BigInt(bps) + 9999n) / 10000n;
      const fee = fixed + percentage;
      const remainder = price - fee;
      const risk = remainder <= 0n;
      if (risk) atRisk++;
      return {route, gateway, priceUsd:dollars(price), feeFloorUsd:dollars(fee),
        afterScenarioFeeUsd:dollars(remainder),
        status: risk ? 'nonpositive-before-computation-and-other-costs'
          : 'positive-after-scenario-fee-margin-unknown'};
    });
    return {name:scenario.name, classification:'fee-sensitivity-only-not-actual-billing',
      flatFeeUsd:dollars(fixed), percentBps:bps, atRisk,
      priceUnknown: rows.filter(r => r.price === null).length,
      observations};
  });
  return {kind:'561.market.fee-exposure.v1', sourceReceipt,
    totalObservedOffers:rows.length, paidSalesVerified:false,
    settlementVerified:false, contributionVerified:false, scenarios,
    caution:'Scenario fee is not billed fee; positive remainder is not profit. Free allowances, compute, hosting, refunds and delivery failures are unmeasured.'};
}
