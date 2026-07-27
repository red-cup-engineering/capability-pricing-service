import assert from "node:assert/strict";
import test from "node:test";
import {
  quoteReservationPrice,
  rankExpectedResolutionPrices,
} from "../src/pricing.mjs";

const credit = {
  kind: "credit",
  asset: "urn:union:credit:relative-resolution-milliquanta-v1",
  unit: "relative-resolution-milliquanta-v1",
};
const q = (numerator, denominator = 1) => ({
  numerator: String(numerator),
  denominator: String(denominator),
});

test("ranks by expected cost of a verified result, not sticker price", () => {
  const result = rankExpectedResolutionPrices({
    taskClass: "software-engineering",
    offers: [
      { provider: "cheap-unreliable", consideration: { ...credit, amount: 20 } },
      { provider: "dearer-reliable", consideration: { ...credit, amount: 30 } },
    ],
    observations: [
      { provider: "cheap-unreliable", taskClass: "software-engineering", outcome: "verified" },
      { provider: "cheap-unreliable", taskClass: "software-engineering", outcome: "refused" },
      { provider: "cheap-unreliable", taskClass: "software-engineering", outcome: "refused" },
      { provider: "cheap-unreliable", taskClass: "software-engineering", outcome: "refused" },
      { provider: "dearer-reliable", taskClass: "software-engineering", outcome: "verified" },
      { provider: "dearer-reliable", taskClass: "software-engineering", outcome: "verified" },
      { provider: "dearer-reliable", taskClass: "software-engineering", outcome: "verified" },
      { provider: "dearer-reliable", taskClass: "software-engineering", outcome: "refused" }
    ]
  });
  assert.deepEqual(result.ranked.map(({ provider }) => provider), ["dearer-reliable", "cheap-unreliable"]);
  assert.deepEqual(result.ranked[0].successProbability, q(3, 4));
  assert.deepEqual(result.ranked[1].successProbability, q(1, 4));
  assert.deepEqual(result.ranked[0].expectedResolutionAmountLowerBound, q(40));
  assert.deepEqual(result.ranked[1].expectedResolutionAmountLowerBound, q(80));
});

test("unknown history remains an interval instead of receiving a fabricated prior", () => {
  const result = rankExpectedResolutionPrices({
    taskClass: "classification",
    offers: [{ provider: "new-provider", consideration: { ...credit, amount: 12 } }],
    observations: [],
  });
  assert.equal(result.ranked[0].evidence, "unknown-history");
  assert.equal(result.ranked[0].successProbability, null);
  assert.equal(result.ranked[0].expectedResolutionAmountLowerBound, null);
  assert.deepEqual(result.ranked[0].unknownCosts, ["dispatch", "verification", "scarcity", "latencyShadow"]);
});

test("an untried provider is explored before a provider with observed zero yield", () => {
  const result = rankExpectedResolutionPrices({
    taskClass: "acceptance-artifact",
    offers: [
      { provider: "observed-zero", consideration: { ...credit, amount: 1 } },
      { provider: "untried", consideration: { ...credit, amount: 100 } },
    ],
    observations: [{ provider: "observed-zero", taskClass: "acceptance-artifact", outcome: "refused" }],
  });
  assert.deepEqual(result.ranked.map(({ provider }) => provider), ["untried", "observed-zero"]);
  assert.deepEqual(result.ranked[1].successProbability, q(0));
});

test("among zero-yield providers the least obstructed route is explored first", () => {
  const observations = [
    ...Array.from({ length: 5 }, () => ({ provider: "repeatedly-refused", taskClass: "acceptance-artifact", outcome: "refused" })),
    ...Array.from({ length: 2 }, () => ({ provider: "less-refused", taskClass: "acceptance-artifact", outcome: "refused" })),
  ];
  const result = rankExpectedResolutionPrices({
    taskClass: "acceptance-artifact",
    offers: [
      { provider: "repeatedly-refused", consideration: { ...credit, amount: 1 } },
      { provider: "less-refused", consideration: { ...credit, amount: 100 } },
    ],
    observations,
  });
  assert.deepEqual(result.ranked.map(({ provider }) => provider), ["less-refused", "repeatedly-refused"]);
  assert.deepEqual(result.ranked.map(({ observations: history }) => history.total), [2, 5]);
});

test("refuses cross-denomination ranking", () => {
  assert.throws(() => rankExpectedResolutionPrices({
    taskClass: "classification",
    offers: [
      { provider: "credits", consideration: { ...credit, amount: 12 } },
      { provider: "cash", consideration: { kind: "currency", asset: "urn:iso:std:iso:4217:-2:USD", unit: "USD", amount: 1 } },
    ],
    observations: [],
  }), /cross-denomination/);
});

test("adds explicit same-denomination dispatch, verification, scarcity, and latency-shadow costs", () => {
  const result = rankExpectedResolutionPrices({
    taskClass: "classification",
    offers: [{
      provider: "provider",
      consideration: { ...credit, amount: 10 },
      additionalCosts: { dispatch: 2, verification: 3, scarcity: 4, latencyShadow: 1 },
    }],
    observations: [{ provider: "provider", taskClass: "classification", outcome: "verified" }],
  });
  assert.deepEqual(result.ranked[0].directAmountLowerBound, q(20));
  assert.deepEqual(result.ranked[0].successProbability, q(1));
  assert.deepEqual(result.ranked[0].expectedResolutionAmountLowerBound, q(20));
});

test("rejects absent, zero, negative, or non-finite quoted amounts", () => {
  for (const amount of [undefined, 0, -1, Number.POSITIVE_INFINITY]) {
    assert.throws(() => rankExpectedResolutionPrices({
      taskClass: "classification",
      offers: [{ provider: "bad", consideration: { ...credit, amount } }],
      observations: [],
    }), /exact fraction|positive/u);
  }
});

test("quotes a positive reservation price from measured costs, delivery probability, and margin", () => {
  const result = quoteReservationPrice({
    denomination: credit,
    resourceLots: [
      { resource: "cpu-millisecond", quantity: q(20), unitRate: { ...credit, amount: q(1, 2) } },
      { resource: "egress-byte", quantity: q(100), unitRate: { ...credit, amount: q(1, 50) } },
    ],
    boundaryCosts: [
      { boundary: "independent-finality-assay", consideration: { ...credit, amount: q(3) } },
      { boundary: "activitypub-publication", consideration: { ...credit, amount: q(5) } },
    ],
    verifiedDeliveryProbability: q(4, 5),
    marginRate: q(1, 5),
    quoteIncrement: q(1),
  });
  assert.deepEqual(result.measuredCost, q(20));
  assert.deepEqual(result.expectedDeliveryCost, q(25));
  assert.deepEqual(result.consideration.amount, q(30));
  assert.deepEqual(result.costBasis.resourceLots[0].amount, q(10));
});

test("refuses missing, zero, or cross-denomination cost evidence", () => {
  const base = {
    denomination: credit,
    resourceLots: [],
    boundaryCosts: [],
    verifiedDeliveryProbability: q(1),
    marginRate: q(0),
    quoteIncrement: q(1),
  };
  assert.throws(() => quoteReservationPrice(base), /at least one measured/u);
  assert.throws(() => quoteReservationPrice({
    ...base,
    resourceLots: [{ resource: "cpu", quantity: q(1), unitRate: { ...credit, amount: q(0) } }],
  }), /must be positive/u);
  assert.throws(() => quoteReservationPrice({
    ...base,
    boundaryCosts: [{
      boundary: "settlement",
      consideration: { kind: "currency", asset: "urn:iso:std:iso:4217:-2:USD", unit: "USD", amount: q(1) },
    }],
  }), /cross-denomination/u);
});

test("requires explicit delivery probability and margin instead of hidden defaults", () => {
  const demand = {
    denomination: credit,
    resourceLots: [{ resource: "cpu", quantity: q(1), unitRate: { ...credit, amount: q(1) } }],
    boundaryCosts: [],
  };
  assert.throws(() => quoteReservationPrice(demand), /verifiedDeliveryProbability/u);
  assert.throws(() => quoteReservationPrice({ ...demand, verifiedDeliveryProbability: q(1) }), /marginRate/u);
  assert.throws(() => quoteReservationPrice({
    ...demand,
    verifiedDeliveryProbability: q(1),
    marginRate: q(0),
  }), /quoteIncrement/u);
});

test("rounds upward to the explicitly selected settlement quantum", () => {
  const result = quoteReservationPrice({
    denomination: credit,
    resourceLots: [{ resource: "cpu", quantity: q(1), unitRate: { ...credit, amount: q(1, 3) } }],
    boundaryCosts: [],
    verifiedDeliveryProbability: q(1),
    marginRate: q(0),
    quoteIncrement: q(1, 10),
  });
  assert.deepEqual(result.unroundedAmount, q(1, 3));
  assert.deepEqual(result.consideration.amount, q(2, 5));
});
