import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMarketFeeExposure} from '../src/market-fee-exposure.mjs';

const sourceReceipt = 'self-host-receipt:2026-10-09:release-997898dd';
const feeScenarios = [{name:'hypothetical-fixed-mill', flatFeeUsd:'0.001'}];
function assess(offers, scenarios=feeScenarios) {
  return assessMarketFeeExposure({offers, feeScenarios:scenarios, sourceReceipt});
}
function offered(price, route='/v1/fixture') { return {route, price}; }

test('requires source receipt but never promotes it to payment proof', () => {
  assert.throws(() => assessMarketFeeExposure({offers:[],feeScenarios}), /sourceReceipt required/);
  const r = assess([offered('0.25')]);
  assert.equal(r.sourceReceipt, sourceReceipt);
  assert.deepEqual([r.paidSalesVerified,r.settlementVerified,r.contributionVerified], [false,false,false]);
});
test('rejects empty or absent fee scenarios', () => {
  assert.throws(() => assessMarketFeeExposure({offers:[],feeScenarios:[],sourceReceipt}), /fee scenario/);
  assert.throws(() => assessMarketFeeExposure({offers:[],sourceReceipt}), /fee scenario/);
});
test('rejects missing or nonarray offers', () => {
  assert.throws(() => assessMarketFeeExposure({feeScenarios,sourceReceipt}), /offers must be an array/);
});
test('exact $0.001 ticket exhausts hypothetical $0.001 flat fee', () => {
  const r=assess([offered('$0.001')]);
  assert.equal(r.scenarios[0].atRisk,1);
  assert.equal(r.scenarios[0].observations[0].afterScenarioFeeUsd,'0');
  assert.match(r.scenarios[0].observations[0].status,/nonpositive/);
});
test('positive remainder is explicitly not reported as profit', () => {
  const r=assess([offered('0.002')]);
  assert.equal(r.scenarios[0].atRisk,0);
  assert.equal(r.scenarios[0].observations[0].afterScenarioFeeUsd,'0.001');
  assert.match(r.scenarios[0].observations[0].status,/margin-unknown/);
  assert.equal(r.contributionVerified,false);
});
test('stage-price benchmark recovers 12 at-risk of 62 without calling them live routes', () => {
  const offers=Array.from({length:62},(_,i)=>offered(i<12?'0.001':i<20?'0.002':'0.01','/v1/stage-only/'+i));
  const r=assess(offers);
  assert.equal(r.totalObservedOffers,62);
  assert.equal(r.scenarios[0].atRisk,12);
  assert.equal(r.scenarios[0].priceUnknown,0);
});
test('missing prices remain unknown rather than zero-dollar sales or costs', () => {
  const r=assess([offered(null),{route:'/v1/missing'}]);
  assert.equal(r.scenarios[0].priceUnknown,2);
  assert.equal(r.scenarios[0].atRisk,0);
  assert.ok(r.scenarios[0].observations.every(x=>x.status==='unquotable-price-unknown'));
});
test('dynamic From price must be normalized or marked unknown upstream', () => {
  assert.throws(()=>assess([offered('From $0.0012')]),/must be an exact USD decimal/);
  assert.equal(assess([offered(null)]).scenarios[0].priceUnknown,1);
});
test('zero scenario fee allowed; positive remainder still not margin', () => {
  const r=assess([offered('0.001')],[{name:'zero-allowance',flatFeeUsd:'0'}]);
  assert.equal(r.scenarios[0].atRisk,0);
  assert.match(r.scenarios[0].observations[0].status,/margin-unknown/);
});
test('whole-dollar and six-decimal normalization is exact', () => {
  const r=assess([offered('$1'),offered('0.000001','/minimum')]);
  assert.equal(r.scenarios[0].observations[0].priceUsd,'1');
  assert.equal(r.scenarios[0].observations[1].priceUsd,'0.000001');
  assert.equal(r.scenarios[0].observations[1].afterScenarioFeeUsd,'-0.000999');
});
test('rejects unrepresentable sub-micro USD prices without rounding', () => {
  assert.throws(()=>assess([offered('0.0000001')]),/exact USD decimal/);
});
test('rejects negative zero NaN and float input', () => {
  for (const price of ['-0.01','0','NaN',0.002])
    assert.throws(()=>assess([offered(price)]),/(?:must be positive|exact USD decimal)/);
});
test('rejects missing scenario labels malformed fees and invalid percentages', () => {
  const bad=[{name:'',flatFeeUsd:'0'},{name:'x',flatFeeUsd:'bad'},
    {name:'x',flatFeeUsd:'0',percentBps:10001},
    {name:'x',flatFeeUsd:'0',percentBps:2.5},
    {name:'x',flatFeeUsd:'0',percentBps:-1}];
  for (const s of bad) assert.throws(()=>assess([offered('0.01')],[s]));
});
test('percentage fee computed in integer microdollars with conservative ceiling', () => {
  const r=assess([offered('0.000001')],[{name:'one basis point',flatFeeUsd:'0',percentBps:1}]);
  assert.equal(r.scenarios[0].observations[0].feeFloorUsd,'0.000001');
  assert.equal(r.scenarios[0].atRisk,1);
});
test('fixed fee and percentage compose without float drift', () => {
  const r=assess([offered('0.25')],[{name:'one-percent-plus',flatFeeUsd:'0.001',percentBps:100}]);
  assert.equal(r.scenarios[0].observations[0].feeFloorUsd,'0.0035');
  assert.equal(r.scenarios[0].observations[0].afterScenarioFeeUsd,'0.2465');
});
test('duplicate offered route rejected rather than double-counted', () => {
  assert.throws(()=>assess([offered('0.1'),offered('0.2')]),/duplicate offered route/);
});
test('rejects routes which are not absolute paths or contain traversal', () => {
  for (const route of ['https://market.561.group/foo','relative','/v1/../secret',''])
    assert.throws(()=>assess([offered('0.1',route)]),/route invalid/);
});
test('gateway retained for reconciliation but not payment authorization', () => {
  const r=assess([{route:'/v1/a',price:'0.5',gateway:'native-selfhost'}]);
  assert.equal(r.scenarios[0].observations[0].gateway,'native-selfhost');
  assert.equal(r.settlementVerified,false);
});
test('unknown and quoted offers distinguished across scenarios', () => {
  const offers=[offered('0.001'),offered('0.25','/large'),offered(null,'/dynamic')];
  const r=assess(offers,[{name:'fee',flatFeeUsd:'0.001'},{name:'free',flatFeeUsd:'0'}]);
  assert.deepEqual(r.scenarios.map(x=>[x.atRisk,x.priceUnknown]),[[1,1],[0,1]]);
  assert.equal(r.scenarios[0].classification,'fee-sensitivity-only-not-actual-billing');
});
