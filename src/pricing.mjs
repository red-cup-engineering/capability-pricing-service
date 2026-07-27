export function rankExpectedResolutionPrices({ taskClass, offers, observations }) {
  if (!Array.isArray(offers) || offers.length === 0) return { ranked: [] };
  if (!Array.isArray(observations)) throw new Error("observations must be an explicit sequence");
  const firstDenomination = denominationKey(offers[0].consideration);
  const costDimensions = ["dispatch", "verification", "scarcity", "latencyShadow"];
  const ranked = offers.map((offer, marketOrdinal) => {
    if (denominationKey(offer.consideration) !== firstDenomination) throw new Error("cross-denomination comparison");
    const quoted = fraction(offer.consideration.amount, "consideration amount");
    const knownCosts = [], unknownCosts = [];
    let directLowerBound = quoted;
    for (const dimension of costDimensions) {
      if (offer.additionalCosts?.[dimension] == null) { unknownCosts.push(dimension); continue; }
      const amount = fraction(offer.additionalCosts[dimension], `${dimension} cost`, { allowZero: true });
      knownCosts.push({ dimension, amount: fractionCarrier(amount) });
      directLowerBound = addFractions(directLowerBound, amount);
    }
    const history = observations.filter((observation) => observation.provider === offer.provider && observation.taskClass === taskClass);
    const verified = history.filter((observation) => observation.outcome === "verified").length;
    const probability = history.length === 0 ? null : fraction({ numerator: String(verified), denominator: String(history.length) }, "observed delivery frequency", { allowZero: true });
    const expectedLowerBound = probability?.numerator > 0n ? divideFractions(directLowerBound, probability) : null;
    return {
      provider: offer.provider,
      evidence: history.length === 0 ? "unknown-history" : "observed-frequency",
      observations: { verified, total: history.length },
      successProbability: probability ? fractionCarrier(probability) : null,
      directAmountLowerBound: fractionCarrier(directLowerBound),
      expectedResolutionAmountLowerBound: expectedLowerBound ? fractionCarrier(expectedLowerBound) : null,
      unknownCosts,
      knownAdditionalCosts: knownCosts,
      comparison: history.length === 0 || unknownCosts.length > 0 ? "partial-order-with-unknowns" : probability.numerator === 0n ? "observed-zero-yield" : "exact-observed-ratio",
      marketOrdinal,
      exactExpectedLowerBound: expectedLowerBound,
    };
  });
  ranked.sort((left, right) => {
    if (left.exactExpectedLowerBound && right.exactExpectedLowerBound) {
      const comparison = left.exactExpectedLowerBound.numerator * right.exactExpectedLowerBound.denominator
        - right.exactExpectedLowerBound.numerator * left.exactExpectedLowerBound.denominator;
      if (comparison !== 0n) return comparison < 0n ? -1 : 1;
    } else if (left.exactExpectedLowerBound) return -1;
    else if (right.exactExpectedLowerBound) return 1;
    if (left.evidence === "unknown-history" && right.successProbability?.numerator === "0") return -1;
    if (right.evidence === "unknown-history" && left.successProbability?.numerator === "0") return 1;
    if (left.successProbability?.numerator === "0" && right.successProbability?.numerator === "0"
        && left.observations.total !== right.observations.total) {
      return left.observations.total - right.observations.total;
    }
    return left.marketOrdinal - right.marketOrdinal;
  });
  return { ranked: ranked.map(({ exactExpectedLowerBound: _exact, marketOrdinal: _ordinal, ...entry }) => entry) };
}

function positive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite`);
  }
  return value;
}

function denominationKey(value) {
  if (typeof value?.kind !== "string" || typeof value?.asset !== "string" || typeof value?.unit !== "string"
      || value.kind === "" || value.asset === "" || value.unit === "") {
    throw new Error("a complete denomination is required");
  }
  return `${value.kind}\0${value.asset}\0${value.unit}`;
}

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fraction(value, label, { allowZero = false } = {}) {
  if (Number.isSafeInteger(value)) value = { numerator: String(value), denominator: "1" };
  if (typeof value?.numerator !== "string" || !/^-?[0-9]+$/u.test(value.numerator)
      || typeof value?.denominator !== "string" || !/^[1-9][0-9]*$/u.test(value.denominator)) {
    throw new Error(`${label} must be an exact fraction with decimal-integer numerator and positive denominator strings`);
  }
  let numerator = BigInt(value.numerator);
  let denominator = BigInt(value.denominator);
  if (numerator < 0n || (!allowZero && numerator === 0n)) {
    throw new Error(`${label} must be ${allowZero ? "nonnegative" : "positive"}`);
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  return Object.freeze({ numerator, denominator });
}

function addFractions(left, right) {
  return fraction({
    numerator: String(left.numerator * right.denominator + right.numerator * left.denominator),
    denominator: String(left.denominator * right.denominator),
  }, "fraction sum", { allowZero: true });
}

function multiplyFractions(left, right) {
  return fraction({
    numerator: String(left.numerator * right.numerator),
    denominator: String(left.denominator * right.denominator),
  }, "fraction product", { allowZero: true });
}

function divideFractions(left, right) {
  if (right.numerator === 0n) throw new Error("cannot divide by zero");
  return fraction({
    numerator: String(left.numerator * right.denominator),
    denominator: String(left.denominator * right.numerator),
  }, "fraction quotient", { allowZero: true });
}

function fractionCarrier(value) {
  return Object.freeze({
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
  });
}

function ceilToIncrement(value, increment) {
  const quotientNumerator = value.numerator * increment.denominator;
  const quotientDenominator = value.denominator * increment.numerator;
  const multiples = (quotientNumerator + quotientDenominator - 1n) / quotientDenominator;
  return multiplyFractions(increment, { numerator: multiples, denominator: 1n });
}

/**
 * Quote the minimum commercial consideration that recovers explicit resource
 * and boundary costs at a declared delivery probability and seller margin.
 * Missing costs are refused rather than interpreted as zero.
 */
export function quoteReservationPrice({
  denomination,
  resourceLots,
  boundaryCosts,
  verifiedDeliveryProbability,
  marginRate,
  quoteIncrement,
}) {
  const expectedDenomination = denominationKey(denomination);
  if (!Array.isArray(resourceLots) || !Array.isArray(boundaryCosts)
      || resourceLots.length + boundaryCosts.length === 0) {
    throw new Error("at least one measured resource lot or boundary cost is required");
  }
  const resources = resourceLots.map((lot, index) => {
    if (typeof lot?.resource !== "string" || lot.resource === "") {
      throw new Error(`resourceLots[${index}].resource is required`);
    }
    const quantity = fraction(lot.quantity, `resourceLots[${index}].quantity`);
    const unitRate = fraction(lot.unitRate?.amount, `resourceLots[${index}].unitRate.amount`);
    if (denominationKey(lot.unitRate) !== expectedDenomination) throw new Error("cross-denomination resource rate");
    const amount = multiplyFractions(quantity, unitRate);
    return Object.freeze({
      resource: lot.resource,
      quantity: fractionCarrier(quantity),
      unitRate: fractionCarrier(unitRate),
      amount: fractionCarrier(amount),
      exactAmount: amount,
    });
  });
  const boundaries = boundaryCosts.map((cost, index) => {
    if (typeof cost?.boundary !== "string" || cost.boundary === "") {
      throw new Error(`boundaryCosts[${index}].boundary is required`);
    }
    const amount = fraction(cost.consideration?.amount, `boundaryCosts[${index}].consideration.amount`);
    if (denominationKey(cost.consideration) !== expectedDenomination) throw new Error("cross-denomination boundary cost");
    return Object.freeze({ boundary: cost.boundary, amount: fractionCarrier(amount), exactAmount: amount });
  });
  const probability = fraction(verifiedDeliveryProbability, "verifiedDeliveryProbability");
  if (probability.numerator > probability.denominator) throw new Error("verifiedDeliveryProbability must not exceed one");
  const margin = fraction(marginRate, "marginRate", { allowZero: true });
  const increment = fraction(quoteIncrement, "quoteIncrement");
  const measuredCost = [...resources, ...boundaries]
    .reduce((sum, item) => addFractions(sum, item.exactAmount), { numerator: 0n, denominator: 1n });
  const expectedDeliveryCost = divideFractions(measuredCost, probability);
  const unroundedAmount = multiplyFractions(
    expectedDeliveryCost,
    addFractions({ numerator: 1n, denominator: 1n }, margin),
  );
  const amount = ceilToIncrement(unroundedAmount, increment);
  return Object.freeze({
    type: "CapabilityReservationPriceQuote",
    denomination: Object.freeze({ ...denomination }),
    measuredCost: fractionCarrier(measuredCost),
    verifiedDeliveryProbability: fractionCarrier(probability),
    expectedDeliveryCost: fractionCarrier(expectedDeliveryCost),
    marginRate: fractionCarrier(margin),
    quoteIncrement: fractionCarrier(increment),
    unroundedAmount: fractionCarrier(unroundedAmount),
    consideration: Object.freeze({ ...denomination, amount: fractionCarrier(amount) }),
    costBasis: Object.freeze({
      resourceLots: Object.freeze(resources.map(({ exactAmount, ...item }) => item)),
      boundaryCosts: Object.freeze(boundaries.map(({ exactAmount, ...item }) => item)),
    }),
  });
}
