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

// CPU batch services (BOINC/Golem-style Work, Slurm resource dimensions,
// Akash CPU provider markets) are no longer silently rejected for lacking GPU.
// All figures here are EXPLICIT SYNTHETIC supplier assertions, not live bids.
const cpuWork = () => {
  const demand = { ...work(), taskClass: "cpu-batch", computeKind: "cpu",
    minCpuCores: 2, minMemoryGiB: 4 };
  delete demand.minVramGiB;
  return demand;
};
const cpuReady = (id = "cpu-worker") => {
  const offer = ready(id);
  offer.supply = { ...offer.supply, cpuCores: 2, memoryGiB: 4, gpuCount: 0 };
  delete offer.supply.vramGiB;
  offer.deliveryHistory.taskClass = "cpu-batch";
  offer.costs["gpu-seconds"] = line("0","0");
  offer.costs["cpu-and-ram"] = {
    ...line("1","3"),
    reservationBasis: { cpuCoreSeconds: "120", ramGiBSeconds: "240" },
  };
  return offer;
};
const cpuQuote = (offers, demand = cpuWork()) =>
  quote(offers,demand);

test("CPU-only Work prices two measured source-claimed capacity dimensions in the original exact provider quote",()=>{
  const result = cpuQuote([cpuReady()]);
  assert.equal(result.computeKind,"cpu");
  assert.equal(result.conditionalRanked.length,1);
  const admitted=result.lowestConditional;
  assert.equal(admitted.computeKind,"cpu");
  assert.deepEqual(admitted.resourceRequirements,
    {minCpuCores:2,minMemoryGiB:4});
  assert.deepEqual(admitted.assertedReservedResourceTime,
    {cpuCoreSeconds:"120",ramGiBSeconds:"240",independentlyMeasured:false});
  assert.deepEqual(admitted.modeledPricePerAcceptedResult,frac(15,4));
  assert.equal(admitted.sourceAssertionsIndependentlyVerified,false);
  assert.equal(result.buyerOrBrokerAuthorized,false);
  assert.equal(result.completedWorkOrSettlementVerified,false);
  assert.equal(result.conditionalRanked[0].purchased,false);
});
test("CPU provider needs actual CPU, RAM and provisioned time; a GPU never substitutes for missing core capacity",()=>{
  const a=cpuReady();a.supply.cpuCores=1;a.supply.memoryGiB=3;
  const x=cpuQuote([a]);
  assert.ok(x.held[0].reasons.includes("cpu-memory-capacity-unproven"));
  a.supply.cpuCores=2;a.supply.memoryGiB=4;
  delete a.supply.cpuCores;
  assert.ok(cpuQuote([a]).held[0].reasons.includes("cpu-memory-capacity-unproven"));
  a.supply.cpuCores=2;
  assert.equal(cpuQuote([a]).conditionalRanked.length,1);
});
test("CPU-only cost must price both source-bounded core-seconds and RAM-GiB-seconds",()=>{
  const def=cpuReady();
  for(const invalid of [
    {reservationBasis:undefined},
    {reservationBasis:{cpuCoreSeconds:"60",ramGiBSeconds:"240"}},
    {reservationBasis:{cpuCoreSeconds:"120",ramGiBSeconds:"120"}},
    {reservationBasis:{cpuCoreSeconds:"120",ramGiBSeconds:"0"}},
    {reservationBasis:{cpuCoreSeconds:"1.5",ramGiBSeconds:"240"}},
    {rate:frac(0)},
    {quantity:frac(0)}
  ]){
    const changed=structuredClone(def);
    changed.costs["cpu-and-ram"]={...changed.costs["cpu-and-ram"],...invalid};
    const result=cpuQuote([changed]);
    assert.ok(result.held[0].reasons.includes("unpriced-or-underbilled-cpu-ram-work"),
      JSON.stringify(invalid));
  }
  const duplicate=cpuReady();
  duplicate.costs["gpu-seconds"]=line("1","1");
  assert.ok(cpuQuote([duplicate]).held[0].reasons.includes("cpu-only-work-has-gpu-charge"));
});
test("CPU rented value ranking uses accepted Work rate rather than raw hourly advertisement",()=>{
 const reliable=cpuReady("verified-cpu");
 reliable.deliveryHistory={...reliable.deliveryHistory,accepted:5,attempted:5};
 const cheap=cpuReady("cheap-cpu");
 cheap.costs["cpu-and-ram"].rate=frac(2);
 cheap.deliveryHistory={...cheap.deliveryHistory,accepted:1,attempted:5};
 const rows=cpuQuote([cheap,reliable]);
 assert.deepEqual(rows.conditionalRanked.map(r=>r.providerId),["verified-cpu","cheap-cpu"]);
 assert.deepEqual(rows.conditionalRanked.map(r=>r.modeledPricePerAcceptedResult),
   [frac(3),frac(10)]);
 assert.equal(rows.completedWorkOrSettlementVerified,false);
});
test("CPU Work enforces regions, deadlines, confidentiality and nonpreemption like GPU Work",()=>{
 const a=cpuReady(), d=cpuWork();
 a.supply.region="EU";a.supply.preemptible=true;
 d.dataClass="confidential";
 let x=cpuQuote([a],d);
 assert.ok(x.held[0].reasons.includes("data-residency-region-refused"));
 assert.ok(x.held[0].reasons.includes("preemption-incompatible"));
 assert.ok(x.held[0].reasons.includes("confidential-work-not-admitted"));
 a.supply.region="US";a.supply.preemptible=false;
 a.supply.dataProtection="confidential-admitted";
 a.supply.elapsedSeconds=400;
 x=cpuQuote([a],d);
 assert.ok(x.held[0].reasons.includes("performance-and-duration-unproved"));
 a.supply.elapsedSeconds=60;
 assert.equal(cpuQuote([a],d).conditionalRanked.length,1);
});
test("CPU-only principal-held capacity remains full economic cost under zero NEW-cash limit",()=>{
 const a=cpuReady(), d=cpuWork();
 d.principalRef="principal:example";d.incrementalCashLimit={
   denomination:usd,maximum:frac(0)};
 a.relationship="principal-held-capacity";
 a.terms.permittedRelationships=["principal-held-capacity"];
 for(const line of Object.values(a.costs)){
  line.cashDisposition="previously-funded";
  line.entitlement={
   accountRef:"account:synthetic-previously-funded",principalRef:d.principalRef,
   sourceUrl:url,observedAt:"2026-10-20T17:30:00Z",
   expiresAt:"2026-10-20T20:00:00Z",
   remainingQuantity:frac(400)
  };
 }
 const x=cpuQuote([a],d);
 assert.equal(x.conditionalRanked.length,1);
 assert.deepEqual(x.lowestConditional.modeledPricePerAcceptedResult,frac(15,4));
 assert.deepEqual(x.lowestConditional.modeledIncrementalCashPerAcceptedResult,frac(0));
 assert.equal(x.lowestConditional.entitledCapacityReserved,false);
 assert.equal(x.buyerOrBrokerAuthorized,false);
 a.costs["cpu-and-ram"].cashDisposition="new-cash";
 assert.ok(cpuQuote([a],d).held[0].reasons.includes("incremental-cash-ceiling-exceeded"));
});
test("CPU kind cannot be spoofed by leaving GPU requirements or omitting CPU bounds",()=>{
 const cases=[{...cpuWork(),computeKind:"invented"},{...cpuWork(),minCpuCores:0},
  {...cpuWork(),minMemoryGiB:undefined},{...cpuWork(),minVramGiB:12}];
 for(const demand of cases)assert.throws(()=>cpuQuote([cpuReady()],demand),/bounded-original-work-demand/);
 // Original GPU consumers remain admitted without an explicit discriminator.
 const original=quote([ready()]);
 assert.equal(original.computeKind,"gpu");
 assert.deepEqual(original.lowestConditional.modeledPricePerAcceptedResult,frac(15,2));
});

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
// PRICE-TIME-01: a parser-normalized impossible date is not a source observation.
// Both the decision cut and dated external offers/entitlements must name real
// calendar instants; syntactic offset awareness alone does not establish this.
test("nonexistent source-calendar dates cannot qualify provider or principal-held headroom",()=>{
 const demand=work();
 const valid=ready();
 // Node Date.parse normalizes 2026-02-30 to March 2 unless source fields are checked.
 assert.throws(()=>quote([valid],demand,"2026-02-30T18:30:00Z"),
  /offset-aware-as-of-required/u);
 const invalid=ready();
 invalid.observedAt="2026-02-30T17:00:00Z";
 invalid.expiresAt="2026-03-03T20:00:00Z";
 const received=quote([invalid],demand,"2026-03-03T18:30:00Z");
 assert.equal(received.conditionalRanked.length,0);
 assert.ok(received.held[0].reasons.includes("expired-future-or-unbounded-quote"));
 const badExpiry=ready();
 badExpiry.observedAt="2026-03-03T17:00:00Z";
 badExpiry.expiresAt="2026-04-31T20:00:00-05:00";
 const expires=quote([badExpiry],demand,"2026-03-03T18:30:00Z");
 assert.equal(expires.conditionalRanked.length,0);
 assert.ok(expires.held[0].reasons.includes("expired-future-or-unbounded-quote"));
 const heldWork=cpuWork();
 heldWork.principalRef="principal:date-test";
 heldWork.incrementalCashLimit={denomination:usd,maximum:frac(0)};
 const heldOffer=cpuReady();
 heldOffer.relationship="principal-held-capacity";
 heldOffer.terms.permittedRelationships=["principal-held-capacity"];
 heldOffer.observedAt="2026-03-03T17:00:00Z";
 heldOffer.expiresAt="2026-03-03T20:00:00Z";
 for(const cost of Object.values(heldOffer.costs)) {
  cost.cashDisposition="previously-funded";
  cost.entitlement={accountRef:"account:test",principalRef:heldWork.principalRef,
   sourceUrl:url,observedAt:"2026-02-30T17:30:00Z",
   expiresAt:"2026-03-03T20:00:00Z",remainingQuantity:frac(400)};
 }
 const entitled=quote([heldOffer],heldWork,"2026-03-03T18:30:00Z");
 assert.equal(entitled.conditionalRanked.length,0);
 assert.ok(entitled.held[0].reasons.includes("prior-entitlement-missing-expired-or-exhausted:cpu-and-ram"));
});
test("real leap-day and timezone-offset source observations stay admissible, never independently certified",()=>{
 const candidateOffer=ready();
 candidateOffer.observedAt="2024-02-29T17:00:00-05:00";
 candidateOffer.expiresAt="2024-03-01T20:00:00-05:00";
 const x=quote([candidateOffer],work(),"2024-03-01T18:30:00-05:00");
 assert.equal(x.conditionalRanked.length,1);
 assert.equal(x.liveQuoteOrSupplyVerified,false);
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
