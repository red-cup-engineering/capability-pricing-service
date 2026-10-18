import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteRewardedAttentionUnit as quote } from '../src/rewarded-attention.mjs';
const base = {
  channel:'sponsored',
  offer:{provider:'example-partner',sourceRef:'urn:external-offer:quoted',state:'quoted',publisherPayoutUsd:'0.100000'},
  costs:{deliveryUsd:'0.005000',reversalReserveUsd:'0.020000',withdrawalFeeReserveUsd:'0.005000',supportComplianceUsd:'0.010000'},
  policy:{acquisitionTargetUsd:'0.020000',retainedMarginUsd:'0.010000'},
  funding:{unencumberedClearedUsd:'1.000000'},
  btcQuote:{sourceRef:'urn:sample:btc-quote',observedAt:'2026-10-17T22:00:00Z',usdPerBtc:'100000.00'}
};
test('scenario explicitly allocates rewards and paid acquisition only from net money',()=>{
  const q=quote(base);
  assert.equal(q.publisherRevenueUsd,'0.1');
  assert.equal(q.disclosedCostAndRetainedMarginUsd,'0.05');
  assert.equal(q.prospectiveAcquisitionAllocationUsd,'0.02');
  assert.equal(q.maximumUserRewardBudgetUsd,'0.03');
  assert.equal(q.userRewardSats,'30');
  assert.match(q.assurance,/scenario-only/);
});
test('lower cleared cash limits both reward and acquisition despite large receivable',()=>{
  const q=quote({...base,funding:{unencumberedClearedUsd:'0.060000'}});
  assert.equal(q.prospectiveAcquisitionAllocationUsd,'0.01');
  assert.equal(q.maximumUserRewardBudgetUsd,'0');
  assert.equal(q.userRewardSats,'0');
});
test('without cleared liquidity a quoted or credited conversion funds no reward and no growth',()=>{
  const q=quote({...base,offer:{...base.offer,state:'credited'},funding:{unencumberedClearedUsd:'0'}});
  assert.equal(q.maximumUserRewardBudgetUsd,'0');
  assert.equal(q.prospectiveAcquisitionAllocationUsd,'0');
});
test('a house ad never manufactures sponsor revenue or sats',()=>{
  const q=quote({...base,channel:'house',offer:undefined,policy:{acquisitionTargetUsd:'0',retainedMarginUsd:'0'}});
  assert.equal(q.publisherRevenueUsd,'0');
  assert.equal(q.userRewardSats,'0');
  assert.throws(()=>quote({...base,channel:'house'}),/house promotion/);
});
test('incomplete cost basis or missing cash refuses instead of assuming zero',()=>{
  assert.throws(()=>quote({...base,costs:{...base.costs,withdrawalFeeReserveUsd:undefined}}),/withdrawalFeeReserveUsd/);
  assert.throws(()=>quote({...base,funding:{}}),/unencumberedClearedUsd/);
  assert.throws(()=>quote({...base,offer:{...base.offer,state:'imagined'}}),/offer.state/);
});
test('btc conversion floors to whole sats, never creates fractional withdrawable sats',()=>{
  const q=quote({...base,offer:{...base.offer,publisherPayoutUsd:'0.050500'},policy:{acquisitionTargetUsd:'0',retainedMarginUsd:'0.01'}});
  assert.equal(q.maximumUserRewardBudgetUsd,'0.0005');
  assert.equal(q.userRewardSats,'0');
});
test('unknown BTC quote returns a USD envelope but never quotes claimable sats',()=>{
  const {btcQuote,...rest}=base;
  const q=quote(rest);
  assert.equal(q.maximumUserRewardBudgetUsd,'0.03');
  assert.equal(q.userRewardSats,null);
});
test('never confuses a hypothetical scenario with an ad callback, settlement or wallet transfer',()=>{
  const q=quote(base);
  for (const k of ['settlement','userPaid','earned','callbackVerified']) assert.equal(k in q,false);
  assert.match(q.warning,/No user has earned sats/);
});
