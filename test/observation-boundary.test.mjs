import test from "node:test";
import assert from "node:assert/strict";
import {authorizeObservationWriter, admitObservationClaim} from "../src/observation-boundary.mjs";

const secret = "A".repeat(64);
const demand = {
  observationId:"receiver-123/result-456", provider:"provider-A", taskClass:"software-receiving",
  outcome:"verified", evidenceRef:"ni:///sha-256;" + "Z".repeat(43),
};

test("write gate fails closed without a configured strong writer identity and secret", () => {
  for (const setting of [
    {secret, writer:""},
    {secret:undefined, writer:"office:receiving"},
    {secret:"tiny", writer:"office:receiving"},
  ]) {
    const result = authorizeObservationWriter({authorization:"Bearer " + secret, ...setting});
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  }
});
test("only a constant-time matching bearer can author a provenance-bound claim", () => {
  const options = {secret, writer:"office:independent-receiving"};
  for (const authorization of [undefined,"","Bearer wrong", "Basic " + secret,
    "Bearer " + secret + " more", "Bearer " + secret + "\n"]) {
    const result = authorizeObservationWriter({...options,authorization});
    assert.equal(result.ok,false);
    assert.equal(result.status,401);
  }
  assert.deepEqual(
    authorizeObservationWriter({...options,authorization:"Bearer " + secret}),
    {ok:true,writer:"office:independent-receiving"},
  );
});
test("admitted claims bind an externally identified source to a service-owned observer and clock", () => {
  const record = admitObservationClaim(demand, {
    writer:"office:independent-receiving",observedAt:"2026-10-16T02:00:00.000Z",
  });
  assert.equal(record.kind,"CapabilityPricingOutcomeClaim.v1");
  assert.equal(record.provider,"provider-A");
  assert.equal(record.observedBy,"office:independent-receiving");
  assert.equal(record.observedAt,"2026-10-16T02:00:00.000Z");
  assert.equal(record.assurance,"authenticated-writer-claim-not-independent-ACK-or-ATT");
  assert.equal(Object.isFrozen(record),true);
  for (const missing of ["observationId","provider","taskClass","evidenceRef"]) {
    const altered={...demand}; delete altered[missing];
    assert.throws(()=>admitObservationClaim(altered,{writer:"office:independent-receiving",observedAt:"now"}));
  }
});
test("caller cannot self-author or inject observation time, receiver, or assurance", () => {
  const trust={writer:"office:independent-receiving",observedAt:"now"};
  assert.throws(()=>admitObservationClaim({...demand, observedAt:"yesterday"},trust),/unknown/);
  assert.throws(()=>admitObservationClaim({...demand,observedBy:"office:fake"},trust),/unknown/);
  assert.throws(()=>admitObservationClaim({...demand,assurance:"independent-ACK"},trust),/unknown/);
  assert.throws(()=>admitObservationClaim({...demand,provider:trust.writer},trust),/own outcome writer/);
  assert.throws(()=>admitObservationClaim({...demand, outcome:"pending"},trust),/outcome/);
  assert.throws(()=>admitObservationClaim({...demand,evidenceRef:"untraceable"},trust),/evidenceRef/);
  assert.throws(()=>admitObservationClaim([],trust),/plain record/);
  assert.throws(()=>admitObservationClaim(null,trust),/plain record/);
});
