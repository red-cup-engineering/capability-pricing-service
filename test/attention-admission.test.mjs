import test from "node:test";
import assert from "node:assert/strict";
import { assessAttentionAdmission as admit } from "../src/attention-admission.mjs";
const budget={audience:"hai-qing",capacityMillis:1000,protectedReserveMillis:700};
const request={id:"msg-1",actor:"561-group",audience:"hai-qing",purpose:"needed-action",attentionMillis:250,consent:true};
test("admits only budgeted consensual attention and exposes reservation",()=>{
 const r=admit({request,budget});assert.equal(r.status,"admissible");assert.equal(r.remainingMillis,300);assert.deepEqual(r.reservation,{id:"msg-1",audience:"hai-qing",actor:"561-group",purpose:"needed-action",attentionMillis:250});
});
test("protects audience consent and attention reserve",()=>{
 assert.equal(admit({request:{...request,consent:false},budget}).status,"consent-required");
 assert.equal(admit({request:{...request,attentionMillis:301},budget}).status,"insufficient-attention");
 assert.throws(()=>admit({request:{...request,audience:"other"},budget}),/cross-audience/);
});
test("idempotent existing reservations cannot double-charge or mutate purpose",()=>{
 const reservations=[{id:"msg-1",audience:"hai-qing",actor:"561-group",purpose:"needed-action",attentionMillis:250}];
 assert.equal(admit({request,budget,reservations}).status,"already-reserved");
 assert.throws(()=>admit({request:{...request,purpose:"advertisement"},budget,reservations}),/idempotency/);
});
test("rejects duplicate ids, overcommitment, negative and unsafe quantities",()=>{
 const row={id:"old",audience:"hai-qing",actor:"x",purpose:"x",attentionMillis:100};
 assert.throws(()=>admit({request,budget,reservations:[row,row]}),/duplicate/);
 assert.throws(()=>admit({request,budget:{...budget,capacityMillis:-1}}),/nonnegative/);
 assert.throws(()=>admit({request:{...request,attentionMillis:Number.MAX_SAFE_INTEGER+1},budget}),/safe integer/);
});
