import test from "node:test";
import assert from "node:assert/strict";
import { compareComputeWorkOffers, COMPUTE_COST_CATEGORIES } from "../src/compute-work-hiring.mjs";

// Entirely synthetic contract and metering evidence: tests check the
// original pricing/qualification boundary, NOT the existence of live quota.
const amount = (n, d=1) => ({ numerator:String(n), denominator:String(d) });
const usd = { kind:"currency", asset:"USD", unit:"USD" };
const evidenceUrl = "https://example.org/compute/observation";
const costs = (q=0, r=amount(0)) => ({
  quantity:amount(q), rate:r, sourceUrl:evidenceUrl,
  cashDisposition:"new-cash"
});
const demand = () => ({
  workRef:"work:example:paid-code-review",
  taskClass:"source-review",
  acceptanceRef:"urn:example:review-acceptance",
  principalRef:"actor:561-accountable-principal",
  minVramGiB:8, maxElapsedSeconds:600,
  allowedRegions:["US"], mayPreempt:false, dataClass:"public",
  budget:{ denomination:usd, maximum:amount(100) },
  incrementalCashLimit:{ denomination:usd, maximum:amount(0) }
});
const offer = () => ({
  providerId:"provider:principal-held-1",
  originalActor:"actor:561-capacity-operator",
  originalPayee:"internal-accounting:capacity-steward",
  offerRef:"https://example.org/compute/held-capacity",
  relationship:"principal-held-capacity",
  terms:{ sourceUrl:"https://example.org/compute/terms",
    status:"permitted", permittedRelationships:["principal-held-capacity"] },
  observedAt:"2026-10-21T04:00:00Z",
  expiresAt:"2026-10-21T08:00:00Z",
  supply:{vramGiB:16,gpuCount:1,region:"US",preemptible:false,
    dataProtection:"public",elapsedSeconds:120,measurementSourceUrl:evidenceUrl},
  deliveryHistory:{taskClass:"source-review",attempted:4,accepted:3,sourceUrl:evidenceUrl},
  pricing:{denomination:usd,marginRate:amount(0),increment:amount(1,100)},
  costs:Object.fromEntries(COMPUTE_COST_CATEGORIES.map(k=>[k,costs()]))
});
function funded(){
  const x=offer();
  x.costs["gpu-seconds"]=costs(120,amount(1,10));
  x.costs["gpu-seconds"].cashDisposition="previously-funded";
  x.costs["gpu-seconds"].entitlement={
    principalRef:"actor:561-accountable-principal",
    accountRef:"compute-account:example-1",
    sourceUrl:"https://example.org/compute/entitlement-receipt",
    observedAt:"2026-10-21T04:15:00Z",
    expiresAt:"2026-10-21T06:00:00Z",
    remainingQuantity:amount(160)
  };
  return x;
}
const asOf="2026-10-21T05:00:00Z";
const quote=(o,d=demand())=>compareComputeWorkOffers({demand:d,offers:Array.isArray(o)?o:[o],asOf});
const refused=(o,d=demand())=>quote(o,d).held[0].reasons;

test("principal-held already-committed GPU slots are economic cost, but zero new cash",()=>{
  const x=quote(funded());
  assert.equal(x.conditionalRanked.length,1);
  assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,amount(16));
  assert.deepEqual(x.lowestConditional.modeledIncrementalCashPerAcceptedResult,amount(0));
  assert.deepEqual(x.incrementalCashLimit,amount(0));
  assert.equal(x.lowestConditional.entitledCapacityReserved,false);
  assert.equal(x.headroomAndCashIndependentlyVerified,false);
  assert.equal(x.buyerOrBrokerAuthorized,false);
  assert.equal(x.completedWorkOrSettlementVerified,false);
});

test("a paid supplier is never confused with a customer's existing entitlement",()=>{
  const no=offer();
  no.providerId="provider:invoice-candidate";
  no.relationship="direct-provider";
  no.terms.permittedRelationships=["direct-provider"];
  no.costs["gpu-seconds"]=costs(120,amount(1,100));
  const x=quote([no,funded()]);
  assert.equal(x.conditionalRanked.length,1);
  assert.equal(x.lowestConditional.providerId,"provider:principal-held-1");
  assert.ok(x.held[0].reasons.includes("principal-held-capacity-required"));
});

test("positive additional expense is refused even below the ordinary economic budget",()=>{
  const o=funded();
  o.costs.egress=costs(1,amount(1,100));
  assert.ok(refused(o).includes("incremental-cash-ceiling-exceeded"));
});

test("omitted cash type is UNKNOWN, not a zero marginal outlay",()=>{
  const o=funded(); delete o.costs.egress.cashDisposition;
  assert.ok(refused(o).includes("cost-cash-disposition-required:egress"));
});

test("previously funded compute must belong to the Work principal",()=>{
  const o=funded();
  o.costs["gpu-seconds"].entitlement.principalRef="actor:unrelated-account";
  assert.ok(refused(o).includes("prior-entitlement-missing-expired-or-exhausted:gpu-seconds"));
});

test("expired, future, unqualified or unreachable entitlement evidence refuses",()=>{
  for(const bad of [
    o=>{o.costs["gpu-seconds"].entitlement.expiresAt="2026-10-21T04:50:00Z";},
    o=>{o.costs["gpu-seconds"].entitlement.observedAt="2026-10-21T06:00:00Z";},
    o=>{o.costs["gpu-seconds"].entitlement.sourceUrl="http://non-secure.invalid";},
    o=>{o.costs["gpu-seconds"].entitlement.accountRef="";}
  ]){
    const o=funded();bad(o);
    assert.ok(refused(o).includes("prior-entitlement-missing-expired-or-exhausted:gpu-seconds"));
  }
});

test("included headroom must cover reliability-adjusted attempted work, not one lucky run",()=>{
  const insufficient=funded();
  insufficient.costs["gpu-seconds"].entitlement.remainingQuantity=amount(159);
  assert.ok(refused(insufficient).includes("prior-entitlement-missing-expired-or-exhausted:gpu-seconds"));
  insufficient.costs["gpu-seconds"].entitlement.remainingQuantity=amount(160);
  assert.equal(quote(insufficient).conditionalRanked.length,1);
});

test("a permissive cash ceiling still counts retries by exact fractions",()=>{
  const o=funded();
  o.costs.egress=costs(2,amount(1,20)); // 0.10 each attempt, 0.133333... per accepted
  const d=demand();d.incrementalCashLimit.maximum=amount(13,100);
  assert.ok(refused(o,d).includes("incremental-cash-ceiling-exceeded"));
  d.incrementalCashLimit.maximum=amount(2,15);
  assert.deepEqual(quote(o,d).lowestConditional.modeledIncrementalCashPerAcceptedResult,amount(8,60));
});

test("a nominally zero GPU rate is still an unpriced resource, not permission to consume it",()=>{
  const o=funded();o.costs["gpu-seconds"].rate=amount(0);
  assert.ok(refused(o).includes("unpriced-or-underbilled-gpu-work"));
});

test("unconstrained original procurement behavior remains intact",()=>{
  const o=offer();
  o.relationship="direct-provider";
  o.terms.permittedRelationships=["direct-provider"];
  o.costs["gpu-seconds"]=costs(120,amount(1,10));
  delete o.costs["gpu-seconds"].cashDisposition;
  const d=demand();delete d.incrementalCashLimit;delete d.principalRef;
  const x=quote(o,d);
  assert.equal(x.conditionalRanked.length,1);
  assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,amount(16));
  assert.equal(x.lowestConditional.modeledIncrementalCashPerAcceptedResult,undefined);
});

test("cash ceiling requires an original principal and exact matching currency",()=>{
  const d=demand();d.principalRef="";
  assert.throws(()=>quote(funded(),d),/bounded-principal-cash-limit-required/);
  d.principalRef="actor:561-accountable-principal";
  d.incrementalCashLimit.denomination={kind:"currency",asset:"EUR",unit:"EUR"};
  assert.throws(()=>quote(funded(),d),/bounded-principal-cash-limit-required/);
});
