import assert from "node:assert/strict";
import test from "node:test";
import { rankExpectedResolutionPrices } from "../src/pricing.mjs";

const credit = {
  kind: "credit",
  asset: "urn:union:credit:relative-resolution-milliquanta-v1",
  unit: "relative-resolution-milliquanta-v1",
};

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
  assert.equal(result.ranked[0].successProbability, 4 / 6);
  assert.equal(result.ranked[1].successProbability, 2 / 6);
  assert.equal(result.ranked[0].expectedResolutionAmount, 45);
  assert.equal(result.ranked[1].expectedResolutionAmount, 60);
});

test("unknown history is explicit and uses a declared prior rather than zero", () => {
  const result = rankExpectedResolutionPrices({
    taskClass: "classification",
    offers: [{ provider: "new-provider", consideration: { ...credit, amount: 12 } }],
    observations: [],
  });
  assert.equal(result.ranked[0].evidence, "unknown-history");
  assert.equal(result.ranked[0].successProbability, 0.5);
  assert.equal(result.ranked[0].expectedResolutionAmount, 24);
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
  assert.equal(result.ranked[0].directAmount, 20);
  assert.equal(result.ranked[0].successProbability, 2 / 3);
  assert.equal(result.ranked[0].expectedResolutionAmount, 30);
});

test("rejects absent, zero, negative, or non-finite quoted amounts", () => {
  for (const amount of [undefined, 0, -1, Number.POSITIVE_INFINITY]) {
    assert.throws(() => rankExpectedResolutionPrices({
      taskClass: "classification",
      offers: [{ provider: "bad", consideration: { ...credit, amount } }],
      observations: [],
    }), /positive finite/);
  }
});
