import test from "node:test";
import assert from "node:assert/strict";
import { assessAttentionAdmission as admit } from "@red-cup-engineering/capability-pricing-service/attention-admission";
const budget={audience:"hai-qing",capacityMillis:1000,protectedReserveMillis:700,consent:true};
const request={id:"msg-1",actor:"561-group",audience:"hai-qing",purpose:"needed-action",attentionMillis:250,consent:true};
test("admits only budgeted consensual attention and exposes reservation",()=>{
 const r=admit({request,budget});assert.equal(r.status,"admissible");assert.equal(r.remainingMillis,300);assert.deepEqual(r.reservation,{id:"msg-1",audience:"hai-qing",actor:"561-group",purpose:"needed-action",attentionMillis:250});
});
test("protects audience consent and attention reserve",()=>{
 assert.equal(admit({request:{...request,consent:false},budget}).status,"consent-required");
 assert.equal(admit({request,budget:{...budget,consent:false}}).status,"consent-required");
 assert.equal(admit({request,budget:{...budget,consent:undefined}}).status,"consent-required");
 assert.equal(admit({request:{...request,attentionMillis:301},budget}).status,"insufficient-attention");
 assert.throws(()=>admit({request:{...request,audience:"other"},budget}),/cross-audience/);
});
test("idempotent existing reservations cannot double-charge or mutate purpose",()=>{
 const reservations=[{id:"msg-1",audience:"hai-qing",actor:"561-group",purpose:"needed-action",attentionMillis:250}];
 const replay=admit({request,budget,reservations});
 assert.equal(replay.status,"already-reserved");
 assert.equal(replay.existingReservation,true);
 assert.equal(replay.reservation,null);
 assert.equal(admit({request,budget:{...budget,consent:false},reservations}).status,"consent-required");
 assert.throws(()=>admit({request:{...request,purpose:"advertisement"},budget,reservations}),/idempotency/);
});
test("rejects duplicate ids, overcommitment, negative and unsafe quantities",()=>{
 const row={id:"old",audience:"hai-qing",actor:"x",purpose:"x",attentionMillis:100};
 assert.throws(()=>admit({request,budget,reservations:[row,row]}),/duplicate/);
 assert.throws(()=>admit({request,budget:{...budget,capacityMillis:-1}}),/nonnegative/);
 assert.throws(()=>admit({request:{...request,attentionMillis:Number.MAX_SAFE_INTEGER+1},budget}),/safe integer/);
});

test("a quote cannot manufacture a witnessed economic event",()=>{
 const admitted=admit({request,budget});
 assert.equal(admitted.kind,"AttentionAdmission.v1");
 assert.equal(admitted.status,"admissible");
 assert.equal("wit" in admitted,false);
 assert.equal("ack" in admitted,false);
 assert.equal("att" in admitted,false);
 assert.match(admitted.note,/not WIT\/ACK\/ATT or settlement/);
});

test("consumed protected reserve must fail closed even for zero-cost admission",()=>{
 const existing=[{id:"old",audience:"hai-qing",actor:"other",purpose:"needed",attentionMillis:350}];
 assert.throws(()=>admit({request:{...request,attentionMillis:0},budget,reservations:existing}),/protected reserve/);
 assert.throws(()=>admit({request,budget:{...budget,capacityMillis:950},reservations:[{...existing[0],attentionMillis:251}]}),/protected reserve/);
 const boundary=admit({request:{...request,attentionMillis:0},budget,reservations:[{...existing[0],attentionMillis:300}]});
 assert.equal(boundary.status,"admissible");
 assert.equal(boundary.remainingMillis,0);
});

