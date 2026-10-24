/**
 * Research-side CPU/GPU Work procurement economics: rank whole cost per
 * accepted original Work with the existing exact quoteReservationPrice.
 * Quoted resources and historical success counts are provider ASSERTIONS,
 * never leases, funds, installed capacity or independently accepted results.
 */
import { quoteReservationPrice } from "./pricing.mjs";

export const COMPUTE_COST_CATEGORIES = Object.freeze([
  "gpu-seconds", "cpu-and-ram", "storage", "egress", "startup",
  "checkpoint-retry", "verification", "payment", "brokerage",
  "support", "capital-carry", "refund-reserve"
]);
export const COMPUTE_WORK_CLASSES = Object.freeze(["cpu", "gpu"]);
export const COMPUTE_RELATIONSHIPS = Object.freeze([
  "direct-provider", "noncustodial-referral", "managed-result",
  "native-network-gateway", "raw-capacity-resale",
  "principal-held-capacity"
]);
const DIGITS = /^(?:0|[1-9][0-9]{0,39})$/u;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const named = x => typeof x === "string" && x.length > 0 && x.trim() === x;
const validTime = x => typeof x === "string" && CLOCK.test(x) && Number.isFinite(Date.parse(x));
const https = x => {
  try {
    const u = new URL(x);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password && !u.hash;
  } catch { return false; }
};
const decimal = (x, positive = false) => typeof x === "string" && DIGITS.test(x) && (!positive || BigInt(x) > 0n);
const fraction = (x, positive = false) => !!x && decimal(x.numerator, positive) && decimal(x.denominator, true);
const denom = x => !!x && ["kind", "asset", "unit"].every(k => named(x[k]));
const sameDenom = (a, b) => denom(a) && denom(b) && ["kind", "asset", "unit"].every(k => a[k] === b[k]);
const difference = (a, b) =>
  BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
const canonical = (numerator, denominator) => {
  // Normalize exact rational cash quantities (not floats) so zero has
  // one stable carrier: 0/1, regardless of the task-class retry ratio.
  let n = BigInt(numerator), d = BigInt(denominator);
  let a = n < 0n ? -n : n, b = d;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: String(n / a), denominator: String(d / a) };
};
const addExact = (a, b) => canonical(
  BigInt(a.numerator) * BigInt(b.denominator) +
    BigInt(b.numerator) * BigInt(a.denominator),
  BigInt(a.denominator) * BigInt(b.denominator)
);
const multiplyExact = (a, b) => canonical(
  BigInt(a.numerator) * BigInt(b.numerator),
  BigInt(a.denominator) * BigInt(b.denominator)
);
const ZERO = Object.freeze({ numerator: "0", denominator: "1" });
const refusal = (offer, reasons) => Object.freeze({
  providerId: offer?.providerId ?? null, offerRef: offer?.offerRef ?? null,
  state: "held", reasons: Object.freeze([...new Set(reasons)]),
  modeledPricePerAcceptedResult: null, purchased: false, received: false,
  commissionReceived: false
});

/**
 * An original provider's asserted offer/terms/observations remain assertions.
 * This assay produces conditionally comparable quotes, never a binding offer.
 *
 * Every one of the twelve price categories must be explicitly accounted for,
 * including categories whose cost is zero; no hidden default service fee.
 */
export function compareComputeWorkOffers({ demand, offers, asOf } = {}) {
  if (!validTime(asOf)) throw new TypeError("offset-aware-as-of-required");
  const now = Date.parse(asOf);
  // Existing original callers are GPU-specific; leaving kind absent preserves
  // their exact contracts. CPU is explicitly selected by a Work owner and
  // still requires source-qualified capacity, duration, rights and economics.
  const computeKind = demand?.computeKind ?? "gpu";
  const kindBounded = COMPUTE_WORK_CLASSES.includes(computeKind);
  const hardwareBounded = computeKind === "cpu"
    ? Number.isSafeInteger(demand?.minCpuCores) && demand.minCpuCores >= 1 &&
      Number.isSafeInteger(demand?.minMemoryGiB) && demand.minMemoryGiB >= 1 &&
      (demand.minVramGiB === undefined || demand.minVramGiB === 0)
    : Number.isSafeInteger(demand?.minVramGiB) && demand.minVramGiB >= 1;
  if (!named(demand?.workRef) || !named(demand?.taskClass) ||
      !named(demand?.acceptanceRef) || !kindBounded || !hardwareBounded ||
      !Number.isSafeInteger(demand?.maxElapsedSeconds) || demand.maxElapsedSeconds < 1 ||
      !Array.isArray(demand?.allowedRegions) || demand.allowedRegions.length === 0 ||
      demand.allowedRegions.some(x => !named(x)) ||
      typeof demand?.mayPreempt !== "boolean" ||
      !["public", "confidential"].includes(demand?.dataClass) ||
      !denom(demand?.budget?.denomination) ||
      !fraction(demand?.budget?.maximum, true)) {
    throw new TypeError("bounded-original-work-demand-required");
  }
  // This is an OPTIONAL constraint on *new cash*, independent of the
  // original all-in economic resource price. No purchase is executed here.
  const cashLimit = demand?.incrementalCashLimit;
  if (cashLimit !== undefined &&
      (!named(demand?.principalRef) ||
       !sameDenom(cashLimit?.denomination, demand?.budget?.denomination) ||
       !fraction(cashLimit?.maximum))) {
    throw new TypeError("bounded-principal-cash-limit-required");
  }
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > 100)
    throw new TypeError("bounded-provider-population-required");

  const seen = new Set(), rows = [];
  for (const offer of offers) {
    const errors = [];
    if (!named(offer?.providerId) || seen.has(offer.providerId)) errors.push("unique-provider-required");
    if (named(offer?.providerId)) seen.add(offer.providerId);
    if (!https(offer?.offerRef) || !https(offer?.terms?.sourceUrl) ||
        !named(offer?.originalActor) || !named(offer?.originalPayee))
      errors.push("original-offer-actor-payee-and-terms-required");
    if (!COMPUTE_RELATIONSHIPS.includes(offer?.relationship) ||
        !Array.isArray(offer?.terms?.permittedRelationships) ||
        !offer.terms.permittedRelationships.includes(offer.relationship) ||
        offer.terms.status !== "permitted")
      errors.push("commercial-relationship-not-permitted");
    if (offer?.relationship === "raw-capacity-resale" &&
        !https(offer?.terms?.explicitSubleaseAgreementUrl))
      errors.push("raw-capacity-resale-permission-unproven");
    // Provider prepayment does not make its RETAIL quote free to the buyer.
    // Only capacity already attributed to this Work principal can be tested
    // against an incremental-cash ceiling. This is still NOT an allocation.
    if (cashLimit && offer?.relationship !== "principal-held-capacity")
      errors.push("principal-held-capacity-required");

    const broker = offer?.costs?.brokerage;
    if (offer?.relationship === "noncustodial-referral" &&
        broker && fraction(broker.rate) && broker.rate.numerator !== "0" &&
        !https(offer?.terms?.brokerFeeAgreementUrl))
      errors.push("broker-fee-agreement-required");
    if (!validTime(offer?.observedAt) || !validTime(offer?.expiresAt) ||
        Date.parse(offer?.observedAt) > now || Date.parse(offer?.expiresAt) <= now ||
        Date.parse(offer?.expiresAt) <= Date.parse(offer?.observedAt))
      errors.push("expired-future-or-unbounded-quote");

    const supply = offer?.supply;
    if (computeKind === "gpu") {
      if (!Number.isSafeInteger(supply?.vramGiB) || supply.vramGiB < demand.minVramGiB ||
          !Number.isSafeInteger(supply?.gpuCount) || supply.gpuCount < 1)
        errors.push("gpu-capacity-unproven");
    } else if (!Number.isSafeInteger(supply?.cpuCores) || supply.cpuCores < demand.minCpuCores ||
        !Number.isSafeInteger(supply?.memoryGiB) || supply.memoryGiB < demand.minMemoryGiB ||
        (supply?.gpuCount !== undefined &&
         (!Number.isSafeInteger(supply.gpuCount) || supply.gpuCount < 0))) {
      errors.push("cpu-memory-capacity-unproven");
    }
    if (!demand.allowedRegions.includes(supply?.region))
      errors.push("data-residency-region-refused");
    if (!demand.mayPreempt && supply?.preemptible !== false)
      errors.push("preemption-incompatible");
    if (demand.dataClass === "confidential" &&
        supply?.dataProtection !== "confidential-admitted")
      errors.push("confidential-work-not-admitted");
    if (!Number.isSafeInteger(supply?.elapsedSeconds) || supply.elapsedSeconds < 1 ||
        supply.elapsedSeconds > demand.maxElapsedSeconds || !https(supply?.measurementSourceUrl))
      errors.push("performance-and-duration-unproved");

    const history = offer?.deliveryHistory;
    if (history?.taskClass !== demand.taskClass ||
        !https(history?.sourceUrl) ||
        !Number.isSafeInteger(history?.attempted) || history.attempted < 1 ||
        !Number.isSafeInteger(history?.accepted) || history.accepted < 1 ||
        history.accepted > history.attempted)
      errors.push("work-class-delivery-history-missing");
    const price = offer?.pricing;
    if (!sameDenom(price?.denomination, demand.budget.denomination))
      errors.push("cross-denomination-without-verified-fx");
    if (!fraction(price?.marginRate) || !fraction(price?.increment, true))
      errors.push("quote-margin-or-settlement-quantum-missing");

    const costs = offer?.costs, kinds = costs && typeof costs === "object" && !Array.isArray(costs)
      ? Object.keys(costs) : [];
    if (kinds.length !== COMPUTE_COST_CATEGORIES.length ||
        kinds.some(k => !COMPUTE_COST_CATEGORIES.includes(k)))
      errors.push("complete-twelve-cost-categories-required");
    const resourceLots = [], explicitZero = [];
    let incrementalCashPerAttempt = ZERO;
    if (kinds.length === COMPUTE_COST_CATEGORIES.length) {
      for (const kind of COMPUTE_COST_CATEGORIES) {
        const line = costs[kind];
        if (!fraction(line?.quantity) || !fraction(line?.rate) || !https(line?.sourceUrl)) {
          errors.push("inexact-or-unsourced-cost:" + kind); continue;
        }
        const qty = BigInt(line.quantity.numerator), rate = BigInt(line.rate.numerator);
        if (cashLimit) {
          if (line.cashDisposition === "new-cash") {
            incrementalCashPerAttempt = addExact(incrementalCashPerAttempt,
              multiplyExact(line.quantity, line.rate));
          } else if (line.cashDisposition === "previously-funded") {
            // One candidate, one observation cut: this checks *modeled* usable
            // headroom, not an atomic ledger reservation across candidates.
            const entitlement = line.entitlement;
            const available = fraction(entitlement?.remainingQuantity, true);
            const current = validTime(entitlement?.observedAt) &&
              validTime(entitlement?.expiresAt) &&
              Date.parse(entitlement.observedAt) <= now &&
              Date.parse(entitlement.expiresAt) > now &&
              Date.parse(entitlement.expiresAt) > Date.parse(entitlement.observedAt);
            const historyReady = Number.isSafeInteger(history?.attempted) &&
              Number.isSafeInteger(history?.accepted) &&
              history.accepted > 0 && history.attempted >= history.accepted;
            const expectedConsumption = historyReady
              ? multiplyExact(line.quantity, {
                numerator: String(history.attempted),
                denominator: String(history.accepted)
              }) : null;
            if (!named(entitlement?.accountRef) ||
                entitlement?.principalRef !== demand.principalRef ||
                !https(entitlement?.sourceUrl) || !current || !available ||
                !historyReady || difference(entitlement.remainingQuantity, expectedConsumption) < 0n)
              errors.push("prior-entitlement-missing-expired-or-exhausted:" + kind);
          } else {
            errors.push("cost-cash-disposition-required:" + kind);
          }
        }
        if (computeKind === "gpu" && kind === "gpu-seconds" &&
            (qty === 0n || rate === 0n ||
             Number.isSafeInteger(supply?.elapsedSeconds) &&
             Number.isSafeInteger(supply?.gpuCount) &&
             qty < BigInt(supply.elapsedSeconds) * BigInt(supply.gpuCount) *
                  BigInt(line.quantity.denominator)))
          errors.push("unpriced-or-underbilled-gpu-work");
        // A CPU-only buyer must not be charged a disguised GPU commodity.
        if (computeKind === "cpu" && kind === "gpu-seconds" &&
            (qty !== 0n || rate !== 0n))
          errors.push("cpu-only-work-has-gpu-charge");
        if (computeKind === "cpu" && kind === "cpu-and-ram") {
          // An unsigned bundle price is NOT enough to know its resource scope.
          // The original supplier must claim separately both resource-time
          // quantities while the original price lot retains ONE monetary rate.
          // Checking the whole provisioned capacity × duration prevents a
          // cheap CPU unit price from hiding unpriced RAM or extra cores.
          const basis = line.reservationBasis;
          const cpu = basis?.cpuCoreSeconds, memory = basis?.ramGiBSeconds;
          const elapsed = Number.isSafeInteger(supply?.elapsedSeconds) &&
            supply.elapsedSeconds > 0 ? BigInt(supply.elapsedSeconds) : null;
          if (!decimal(cpu, true) || !decimal(memory, true) ||
              elapsed === null || !Number.isSafeInteger(supply?.cpuCores) ||
              supply.cpuCores <= 0 || !Number.isSafeInteger(supply?.memoryGiB) ||
              supply.memoryGiB <= 0 ||
              BigInt(cpu || "0") < elapsed * BigInt(supply.cpuCores || 0) ||
              BigInt(memory || "0") < elapsed * BigInt(supply.memoryGiB || 0) ||
              qty === 0n || rate === 0n)
            errors.push("unpriced-or-underbilled-cpu-ram-work");
        }
        if (qty === 0n || rate === 0n) { explicitZero.push(kind); continue; }
        resourceLots.push({
          resource: kind,
          quantity: line.quantity,
          unitRate: { ...price?.denomination, amount: line.rate }
        });
      }
    }
    if (errors.length) { rows.push(refusal(offer, errors)); continue; }
    const incrementalCashPerAccepted = cashLimit
      ? multiplyExact(incrementalCashPerAttempt, {
        numerator: String(history.attempted),
        denominator: String(history.accepted)
      }) : null;
    if (cashLimit && difference(incrementalCashPerAccepted, cashLimit.maximum) > 0n) {
      rows.push(refusal(offer, ["incremental-cash-ceiling-exceeded"])); continue;
    }
    let conditional;
    try {
      conditional = quoteReservationPrice({
        denomination: price.denomination, resourceLots, boundaryCosts: [],
        verifiedDeliveryProbability: {
          numerator: String(history.accepted), denominator: String(history.attempted)
        },
        marginRate: price.marginRate, quoteIncrement: price.increment
      });
    } catch {
      rows.push(refusal(offer, ["invalid-underlying-capability-price-input"])); continue;
    }
    const overBudget = difference(conditional.consideration.amount, demand.budget.maximum) > 0n;
    rows.push(Object.freeze({
      providerId: offer.providerId, offerRef: offer.offerRef, originalActor: offer.originalActor,
      originalPayee: offer.originalPayee, relationship: offer.relationship,
      computeKind,
      resourceRequirements: Object.freeze(computeKind === "cpu"
        ? { minCpuCores: demand.minCpuCores, minMemoryGiB: demand.minMemoryGiB }
        : { minVramGiB: demand.minVramGiB }),
      ...(computeKind === "cpu" ? { assertedReservedResourceTime: Object.freeze({
        cpuCoreSeconds: costs["cpu-and-ram"].reservationBasis.cpuCoreSeconds,
        ramGiBSeconds: costs["cpu-and-ram"].reservationBasis.ramGiBSeconds,
        independentlyMeasured: false
      }) } : {}),
      state: overBudget ? "over-budget" : "conditional-comparable",
      reasons: Object.freeze(overBudget ? ["whole-work-budget-exceeded"] : []),
      denomination: conditional.denomination,
      modeledPricePerAcceptedResult: conditional.consideration.amount,
      costBasis: conditional.costBasis.resourceLots, explicitZeroCostKinds: Object.freeze(explicitZero),
      assertedDeliveryRatio: Object.freeze({ accepted: history.accepted, attempted: history.attempted }),
      sourceAssertionsIndependentlyVerified: false,
      ...(cashLimit ? {
        modeledIncrementalCashPerAcceptedResult: incrementalCashPerAccepted,
        incrementalCashLimit: cashLimit.maximum,
        entitledCapacityReserved: false
      } : {}),
      purchased: false, received: false, commissionReceived: false
    }));
  }
  const comparable = rows.filter(x => x.state === "conditional-comparable");
  comparable.sort((a,b) => {
    const d = difference(a.modeledPricePerAcceptedResult,b.modeledPricePerAcceptedResult);
    return d < 0n ? -1 : d > 0n ? 1 : a.providerId.localeCompare(b.providerId);
  });
  return Object.freeze({
    type: "ComputeWorkPriceComparison", version: 1, workRef: demand.workRef, asOf,
    computeKind,
    conditionalRanked: Object.freeze(comparable),
    held: Object.freeze(rows.filter(x => x.state !== "conditional-comparable")),
    lowestConditional: comparable[0] ?? null,
    currentSourceObservationsIndependentlyVerified: false,
    buyerOrBrokerAuthorized: false, liveQuoteOrSupplyVerified: false,
    completedWorkOrSettlementVerified: false,
    ...(cashLimit ? {
      incrementalCashLimit: cashLimit.maximum,
      headroomAndCashIndependentlyVerified: false
    } : {}),
    note: "Quoted provider terms, delivery counts, entitlements and price lines are unverified input claims until source-owned independent receiving"
  });
}
