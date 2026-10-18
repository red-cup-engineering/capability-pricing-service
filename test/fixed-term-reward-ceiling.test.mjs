import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFixedTermRewardCeiling,quoteFundedFixedTerm} from '../src/fixed-term-reward-ceiling.mjs';
const terms={
 termsRef:'urn:yabcm:authored:terms-v1',
 planId:'demo-analogue-eight-hour-finite',
 durationSeconds:8*3600,
 maxBaseRewardMsatPerHour:'1000',
 maxTotalMultiplierBps:49000,
 maxExtraBonusMsat:'500',
 maxWithdrawals:2,
 maxRoutingFeeMsatEach:'150'
};
const wallet={id:'regtest-payout',network:'regtest',ready:true,
 observedAt:'2026-10-17T23:00:00Z',sourceRef:'urn:cln:regtest:read',
 spendableOutboundMsat:'1000000'};
const book={walletId:'regtest-payout',revision:'journal:4',otherCommittedMsat:'0',claims:[]};
const policy={network:'regtest',asOf:'2026-10-17T23:00:05Z',maxSnapshotAgeMs:10000,liquiditySafetyReserveMsat:'50000'};
test('full 8-hour term includes 4.9x boost plus fixed bonus and multiple routing fees',()=>{
 const c=compileFixedTermRewardCeiling(terms);
 assert.equal(c.maxRewardMsat,'39700');
 assert.equal(c.maxRoutingFeeMsat,'300');
 assert.equal(c.requiredPrefundMsat,'40000');
 assert.equal(c.maxRewardSatsCeil,'40');
 assert.equal(c.maxRoutingFeeSatsCeil,'1');
});
test('composed Lightning capacity reserves whole sat rounded amount before sale',()=>{
 const q=quoteFundedFixedTerm({wallet,book,terms,actor:'alice',intentId:'sale-1',policy});
 assert.equal(q.ceiling.requiredPrefundMsat,'40000');
 assert.equal(q.capacity.state,'capacity-quoted');
 assert.equal(q.capacity.capacityFits,true);
 assert.equal(q.capacity.saleReservation.maxRemainingRewardMsat,'39700');
 assert.equal(q.capacity.saleReservation.maxRemainingFeeMsat,'300');
 assert.equal(q.acceptedSale,false);
});
test('real-money contract refuses if cash wallet too small',()=>{
 const q=quoteFundedFixedTerm({wallet:{...wallet,spendableOutboundMsat:'89999'},
  book,terms,actor:'alice',intentId:'sale-1',policy});
 assert.equal(q.capacity.state,'sold-out');
 assert.equal(q.capacity.saleReservation,null);
});
test('missing or unlimited multipliers, bonus or fees fail closed',()=>{
 for(const field of ['maxTotalMultiplierBps','maxExtraBonusMsat','maxRoutingFeeMsatEach','maxWithdrawals']){
  assert.throws(()=>compileFixedTermRewardCeiling({...terms,[field]:undefined}),/must be|millisatoshi|string/i);
 }
 assert.throws(()=>compileFixedTermRewardCeiling({...terms,maxTotalMultiplierBps:Infinity}),/bounded/);
 assert.throws(()=>compileFixedTermRewardCeiling({...terms,maxTotalMultiplierBps:1000001}),/bounded/);
});
test('unbounded term, zero-positive promise and malformed exact units refuse',()=>{
 assert.throws(()=>compileFixedTermRewardCeiling({...terms,durationSeconds:Infinity}),/bounded/);
 assert.throws(()=>compileFixedTermRewardCeiling({...terms,maxBaseRewardMsatPerHour:'0',maxExtraBonusMsat:'0'}),/positive/);
 assert.throws(()=>compileFixedTermRewardCeiling({...terms,maxExtraBonusMsat:'0.5'}),/millisatoshi/);
});
test('different underlying rules produce independently re-derived contract ceilings',()=>{
 const q1=compileFixedTermRewardCeiling(terms);
 const q2=compileFixedTermRewardCeiling({...terms,durationSeconds:7*86400,termsRef:'urn:yabcm:week'});
 assert.ok(BigInt(q2.maxRewardMsat)>BigInt(q1.maxRewardMsat));
 assert.notEqual(q1.termsRef,q2.termsRef);
});
