import test from "node:test";
import assert from "node:assert/strict";
import { compareComputeWorkOffers, COMPUTE_COST_CATEGORIES } from "../src/compute-work-hiring.mjs";

const frac = (n, d=1) => ({numerator:String(n),denominator:String(d)});
const usd = {kind:"currency",asset:"USD",unit:"USD"};
const url = "https://provider.example/evidence";
const line = (q="0",rate="0") => ({quantity:frac(q),rate:frac(rate),sourceUrl:url});
const work = () => ({
  workRef:"work:synthetic:transcribe-1",taskClass:"transcription",
  acceptanceRef:"test:accepted-transcription-hash",
  minVramGiB:16,maxElapsedSeconds:360,allowedRegions:["US","CA"],
  mayPreempt:false,dataClass:"public",
  budget:{denomination:usd,maximum:frac(25)}
});
const candidate = (id="provider-a") => ({
  providerId:id,originalActor:"actor:"+id,originalPayee:"payee:"+id,
  offerRef:"https://"+id+".example/offers/work",
  relationship:"direct-provider",
  terms:{sourceUrl:"https://"+id+".example/terms",
    status:"permitted",permittedRelationships:["direct-provider"]},
  observedAt:"2026-10-20T17:00:00Z",expiresAt:"2026-10-20T20:00:00Z",
  supply:{vramGiB:24,gpuCount:1,region:"US",preemptible:false,
    dataProtection:"public",elapsedSeconds:60,measurementSourceUrl:url},
  deliveryHistory:{taskClass:"transcription",accepted:4,attempted:5,sourceUrl:url},
  pricing:{denomination:usd,marginRate:frac(0),increment:frac(1,100)},
  costs:Object.fromEntries(COMPUTE_COST_CATEGORIES.map(k=>[k,line()]))
});
const quote = (offers, demand=work(), at="2026-10-20T18:30:00Z") =>
  compareComputeWorkOffers({demand,offers,asOf:at});
const ready = (id) => {
 const x=candidate(id);
 x.costs["gpu-seconds"]=line("60","1");
 x.costs["gpu-seconds"].rate=frac(1,10); // $0.10 per GPU-second: $6 for one completed attempt
 return x;
};
const held = (x) => quote([x]).held[0];

test("twelve compute Work costs are original, explicit, and not a broker marketplace",()=>{
 assert.equal(COMPUTE_COST_CATEGORIES.length,12);
 assert.ok(COMPUTE_COST_CATEGORIES.includes("checkpoint-retry"));
 assert.ok(COMPUTE_COST_CATEGORIES.includes("capital-carry"));
 assert.ok(COMPUTE_COST_CATEGORIES.includes("brokerage"));
});
test("original quote engine produces exact conditional expected price per accepted outcome",()=>{
 const x=quote([ready()]);
 assert.equal(x.conditionalRanked.length,1);
 assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,frac(15,2));
 assert.equal(x.held.length,0);
 assert.equal(x.type,"ComputeWorkPriceComparison");
 assert.equal(x.buyerOrBrokerAuthorized,false);
 assert.equal(x.completedWorkOrSettlementVerified,false);
});
test("higher GPU rate can beat lower sticker price when completed Work reliability differs",()=>{
 const a=ready("reliable");a.deliveryHistory.accepted=5;a.deliveryHistory.attempted=5;
 const b=ready("cheaper");b.costs["gpu-seconds"].rate=frac(1,20);
 b.deliveryHistory.accepted=1;b.deliveryHistory.attempted=4;
 const x=quote([b,a]);
 assert.deepEqual(x.conditionalRanked.map(r=>r.providerId),["reliable","cheaper"]);
 assert.deepEqual(x.conditionalRanked.map(r=>r.modeledPricePerAcceptedResult),[frac(6),frac(12)]);
});
test("faster work can beat slower work at the same published GPU-second rate",()=>{
 const a=ready("slow");const b=ready("fast");
 b.supply.elapsedSeconds=30;b.costs["gpu-seconds"].quantity=frac(30);
 const x=quote([a,b]);
 assert.equal(x.lowestConditional.providerId,"fast");
 assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,frac(15,4));
});
test("same cost ties use provider identity, never simulated commission",()=>{
 const x=quote([ready("zulu"),ready("alpha")]);
 assert.deepEqual(x.conditionalRanked.map(r=>r.providerId),["alpha","zulu"]);
 assert.equal(x.lowestConditional.commissionReceived,false);
});
test("an explicit positive margin changes managed-service quote but not verified profit",()=>{
 const a=ready();a.relationship="managed-result";
 a.terms.permittedRelationships=["managed-result"];a.pricing.marginRate=frac(1,5);
 const x=quote([a]);
 assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,frac(9));
 assert.equal(x.lowestConditional.received,false);
});
test("all omitted costs are unknown, not zero",()=>{
 const a=ready();delete a.costs["egress"];
 const x=held(a);
 assert.ok(x.reasons.includes("complete-twelve-cost-categories-required"));
});
test("explicit zero categories retain provenance and are not hidden broker fees",()=>{
 const x=quote([ready()]);
 assert.equal(x.lowestConditional.explicitZeroCostKinds.length,11);
 assert.ok(x.lowestConditional.explicitZeroCostKinds.includes("brokerage"));
});
test("nonzero referral commission requires an original agreement",()=>{
 const a=ready();a.relationship="noncustodial-referral";
 a.terms.permittedRelationships=["noncustodial-referral"];
 a.costs.brokerage=line("1","1");
 assert.ok(held(a).reasons.includes("broker-fee-agreement-required"));
 a.terms.brokerFeeAgreementUrl="https://provider.example/agency-agreement";
 assert.equal(quote([a]).conditionalRanked.length,1);
});
test("raw GPU capacity resale requires an independent exact sublease permission",()=>{
 const a=ready();a.relationship="raw-capacity-resale";
 a.terms.permittedRelationships=["raw-capacity-resale"];
 assert.ok(held(a).reasons.includes("raw-capacity-resale-permission-unproven"));
 a.terms.explicitSubleaseAgreementUrl="https://provider.example/approved-sublet";
 assert.equal(quote([a]).conditionalRanked.length,1);
});
test("provider published terms denying a relationship refuse even available GPUs",()=>{
 const a=ready();a.terms.status="prohibited";
 assert.ok(held(a).reasons.includes("commercial-relationship-not-permitted"));
 a.terms.status="permitted";a.terms.permittedRelationships=["noncustodial-referral"];
 assert.ok(held(a).reasons.includes("commercial-relationship-not-permitted"));
});
test("different native NOS/AKT denominations cannot be silently converted to USD",()=>{
 for(const other of [{kind:"token",asset:"NOS",unit:"NOS"},{kind:"token",asset:"uAKT",unit:"uAKT"}]){
  const a=ready();a.pricing.denomination=other;
  assert.ok(held(a).reasons.includes("cross-denomination-without-verified-fx"));
 }
});
test("different accepted Work tasks cannot borrow unrelated success histories",()=>{
 const a=ready();a.deliveryHistory.taskClass="video-rendering";
 assert.ok(held(a).reasons.includes("work-class-delivery-history-missing"));
});
test("no historical accepted results means unresolved probability, not a free quote",()=>{
 const a=ready();a.deliveryHistory.accepted=0;
 assert.ok(held(a).reasons.includes("work-class-delivery-history-missing"));
});
test("confidential data stays within an admitted provider assurance",()=>{
 const a=ready();const d=work();d.dataClass="confidential";
 assert.ok(quote([a],d).held[0].reasons.includes("confidential-work-not-admitted"));
 a.supply.dataProtection="confidential-admitted";
 assert.equal(quote([a],d).conditionalRanked.length,1);
});
test("GPU memory, data region and availability must each match the original Work",()=>{
 const a=ready();a.supply.vramGiB=8;a.supply.region="EU";a.supply.gpuCount=0;
 const x=held(a);
 assert.ok(x.reasons.includes("gpu-capacity-unproven"));
 assert.ok(x.reasons.includes("data-residency-region-refused"));
});
test("preemptible cheap workers cannot accept a noncheckpointable job",()=>{
 const a=ready();a.supply.preemptible=true;
 assert.ok(held(a).reasons.includes("preemption-incompatible"));
 const d=work();d.mayPreempt=true;
 assert.equal(quote([a],d).conditionalRanked.length,1);
});
test("missing performance source and excessive duration block speculative cheap offer",()=>{
 const a=ready();a.supply.measurementSourceUrl="";
 a.supply.elapsedSeconds=400;
 assert.ok(held(a).reasons.includes("performance-and-duration-unproved"));
});
test("time spent across multiple GPUs must be honestly charged",()=>{
 const a=ready();a.supply.gpuCount=2;
 assert.ok(held(a).reasons.includes("unpriced-or-underbilled-gpu-work"));
 a.costs["gpu-seconds"].quantity=frac(120);
 assert.equal(quote([a]).conditionalRanked.length,1);
});
test("a valid fractional GPU charge is exact and cannot be rounded away",()=>{
 const a=ready();a.costs["gpu-seconds"].rate=frac(1,1000000);
 const x=quote([a]);
 assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,frac(1,100));
});
test("all-in work budget excludes a complete quote, not just the provider sticker",()=>{
 const a=ready();const d=work();d.budget.maximum=frac(7);
 const x=quote([a],d);
 assert.equal(x.conditionalRanked.length,0);
 assert.equal(x.held[0].state,"over-budget");
 assert.ok(x.held[0].reasons.includes("whole-work-budget-exceeded"));
});
test("invalid, future, expired and timezone-ambiguous quotes cannot count",()=>{
 const a=ready();a.expiresAt="2026-10-20T18:00:00Z";
 assert.ok(held(a).reasons.includes("expired-future-or-unbounded-quote"));
 a.expiresAt="2026-10-20T20:00:00Z";a.observedAt="2026-10-20T19:00:00Z";
 assert.ok(held(a).reasons.includes("expired-future-or-unbounded-quote"));
 a.observedAt="2026-10-20T17:00:00";
 assert.ok(held(a).reasons.includes("expired-future-or-unbounded-quote"));
});
test("malicious source URLs cannot provide fake original seller or observed cost evidence",()=>{
 const a=ready();a.offerRef="http://attacker.invalid/offers";
 a.costs["gpu-seconds"].sourceUrl="https://example.com/@user#fragment";
 assert.ok(held(a).reasons.includes("original-offer-actor-payee-and-terms-required"));
 assert.ok(held(a).reasons.includes("inexact-or-unsourced-cost:gpu-seconds"));
});
test("malformed exact numbers and float quantities fail closed instead of rounding",()=>{
 for(const bad of [-1,3.2,"1.5","-1","001","1e5"]){
  const a=ready();a.costs["gpu-seconds"].quantity={numerator:bad,denominator:"1"};
  assert.ok(held(a).reasons.includes("inexact-or-unsourced-cost:gpu-seconds"));
 }
});
test("duplicate provider identities are not silently double-ranked",()=>{
 const a=ready();const b=ready();const x=quote([a,b]);
 assert.equal(x.conditionalRanked.length,1);
 assert.ok(x.held[0].reasons.includes("unique-provider-required"));
});
test("source claims and a completed quote are not a verified lease, paid brokerage, or customer acceptance",()=>{
 const x=quote([ready()]);
 assert.equal(x.lowestConditional.sourceAssertionsIndependentlyVerified,false);
 assert.equal(x.liveQuoteOrSupplyVerified,false);
 assert.equal(x.currentSourceObservationsIndependentlyVerified,false);
 assert.equal(x.customerWorkAccepted,undefined);
 assert.equal(x.buyerOrBrokerAuthorized,false);
 assert.equal(x.completedWorkOrSettlementVerified,false);
});
test("invalid work root and unbounded offer batch throw explicitly",()=>{
 assert.throws(()=>compareComputeWorkOffers({demand:work(),offers:[ready()],asOf:"2026-10-20T18:30:00"}),/offset-aware/);
 const bad=work();bad.budget.maximum=frac(0);
 assert.throws(()=>quote([ready()],bad),/bounded-original-work/);
 assert.throws(()=>quote([]),/bounded-provider-population/);
 assert.throws(()=>quote(Array(101).fill(ready())),/bounded-provider-population/);
});
