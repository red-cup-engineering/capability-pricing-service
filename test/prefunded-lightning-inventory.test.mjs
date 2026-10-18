import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPrefundedLightningSale as quote,
  projectCoreLightningOutbound as project,
} from '../src/prefunded-lightning-inventory.mjs';

const fixture=()=>({
  wallet:{id:'payout-wallet',network:'regtest',ready:true,observedAt:'2026-10-17T23:00:00Z',
    sourceRef:'urn:regtest:trusted-node-observation',spendableOutboundMsat:'10000000'},
  book:{walletId:'payout-wallet',revision:'journal:4',otherCommittedMsat:'500000',
    claims:[{intentId:'old',actor:'alice',walletId:'payout-wallet',termsRef:'urn:plan:old',
      state:'active',maxRemainingRewardMsat:'2000000',maxRemainingFeeMsat:'100000'}]},
  sale:{walletId:'payout-wallet',actor:'bob',intentId:'new',termsRef:'urn:plan:day',
    maxRewardSats:'2000',maxRoutingFeeSats:'100'},
  policy:{network:'regtest',asOf:'2026-10-17T23:00:15Z',maxSnapshotAgeMs:60000,
    liquiditySafetyReserveMsat:'1000000'}
});

test('whole-contract pre-funded quote includes every older liability and safety buffer',()=>{
 const q=quote(fixture());
 assert.equal(q.kind,'PrefundedLightningSaleQuote.v1');
 assert.equal(q.state,'capacity-quoted');
 assert.equal(q.admitted,true);
 assert.equal(q.spendableMsat,'10000000');
 assert.equal(q.coveredExistingMsat,'2600000');
 assert.equal(q.availableMsat,'6400000');
 assert.equal(q.saleReservation.maxRemainingRewardMsat,'2000000');
 assert.equal(q.saleReservation.maxRemainingFeeMsat,'100000');
 assert.equal(q.saleReservation.expectedBookRevision,'journal:4');
 assert.equal(q.additionalWholeOffersAtThisSnapshot,'3');
});

test('after the previous quote is actually booked, a second sale sees less room',()=>{
 const f=fixture();
 const accepted=quote(f).saleReservation;
 const next={...f,book:{...f.book,revision:'journal:5',claims:[...f.book.claims,accepted]},
   sale:{...f.sale,actor:'chloe',intentId:'new2'}};
 const q=quote(next);
 assert.equal(q.coveredExistingMsat,'4700000');
 assert.equal(q.availableMsat,'4300000');
 assert.equal(q.additionalWholeOffersAtThisSnapshot,'2');
});

test('idempotent sale identity never returns a second reservation',()=>{
 const f=fixture();const claim=quote(f).saleReservation;
 const r=quote({...f,book:{...f.book,claims:[...f.book.claims,claim]}});
 assert.equal(r.state,'already-reserved');
 assert.equal(r.admitted,false);
 assert.equal(r.saleReservation,null);
 assert.throws(()=>quote({...f,book:{...f.book,claims:[...f.book.claims,claim]},
   sale:{...f.sale,actor:'mallory'}}),/idempotency key/);
});

test('sold out never authorizes a sale merely because it has a high price',()=>{
 const f=fixture();
 const q=quote({...f,sale:{...f.sale,maxRewardSats:'6401',maxRoutingFeeSats:'0'}});
 assert.equal(q.state,'sold-out');assert.equal(q.admitted,false);
 assert.equal(q.saleReservation,null);
});

test('wallet already underfunded suspends new sales without releasing old obligations',()=>{
 const f=fixture();
 const q=quote({...f,wallet:{...f.wallet,spendableOutboundMsat:'2500000'}});
 assert.equal(q.state,'suspended-underfunded');
 assert.equal(q.saleReservation,null);
 assert.equal(q.coveredExistingMsat,'2600000');
});

test('testnet and mainnet cannot share reservations or liquidity',()=>{
 const f=fixture();
 assert.throws(()=>quote({...f,policy:{...f.policy,network:'mainnet'}}),/network/);
 assert.throws(()=>quote({...f,sale:{...f.sale,walletId:'other'}}),/wrong payout wallet/);
 assert.throws(()=>quote({...f,book:{...f.book,walletId:'other'}}),/custody mismatch/);
});

test('stale, future, or unready wallet snapshot fails closed',()=>{
 const f=fixture();
 assert.throws(()=>quote({...f,policy:{...f.policy,asOf:'2026-10-18T01:00:00Z'}}),/stale/);
 assert.throws(()=>quote({...f,wallet:{...f.wallet,observedAt:'2026-10-18T00:00:00Z'}}),/future/);
 assert.throws(()=>quote({...f,wallet:{...f.wallet,ready:false}}),/not ready/);
});

test('unknown costs, malformed exact sats, and unknown obligations refuse',()=>{
 const f=fixture();
 assert.throws(()=>quote({...f,sale:{...f.sale,maxRoutingFeeSats:undefined}}),/exact nonnegative/);
 assert.throws(()=>quote({...f,sale:{...f.sale,maxRewardSats:'1.9'}}),/exact nonnegative/);
 assert.throws(()=>quote({...f,book:{...f.book,claims:[{...f.book.claims[0],state:'settled-unverified'}]}}),/state not known/);
 assert.throws(()=>quote({...f,book:{...f.book,claims:[f.book.claims[0],f.book.claims[0]]}}),/duplicate/);
});

test('Core Lightning uses ACTIVE outbound spendable liquidity, not onchain nor inbound',()=>{
 const wallet=project({result:{channels:[
  {state:'CHANNELD_NORMAL',peer_connected:true,spendable_msat:6000000,receivable_msat:999999999},
  {state:'CHANNELD_NORMAL',peer_connected:true,spendable_msat:'4000000msat'},
  {state:'ONCHAIN',peer_connected:true,spendable_msat:'9000000msat'},
 ]},walletId:'node-1',network:'regtest',observedAt:'2026-10-17T23:00:00Z',sourceRef:'urn:cln:receipt'});
 assert.equal(wallet.ready,true);
 assert.equal(wallet.spendableOutboundMsat,'10000000');
});

test('missing channel spendable information cannot be substituted with local balance',()=>{
 assert.throws(()=>project({result:{channels:[{state:'CHANNELD_NORMAL',peer_connected:true,to_us_msat:9000000}]},
  walletId:'node-1',network:'regtest',observedAt:'2026-10-17T23:00:00Z',sourceRef:'urn:cln:receipt'}),/spendable_msat/);
 const empty=project({result:{channels:[]},walletId:'node-1',network:'regtest',
  observedAt:'2026-10-17T23:00:00Z',sourceRef:'urn:cln:receipt'});
 assert.equal(empty.ready,false);assert.equal(empty.spendableOutboundMsat,'0');
});

test('a quote is never falsely marked as payment, ledger commitment or user earnings',()=>{
 const q=quote(fixture());
 for (const name of ['paid','mined','settled','walletPayment','ledgerCommitted']) assert.equal(name in q,false);
 assert.match(q.note,/Commit the booking atomically/);
});

test('stale simultaneous quotes expose why a transactional book writer is mandatory',()=>{
 const f=fixture();const c={...f,wallet:{...f.wallet,spendableOutboundMsat:'6000000'}};
 const a=quote({...c,sale:{...c.sale,actor:'a',intentId:'a'}});
 const b=quote({...c,sale:{...c.sale,actor:'b',intentId:'b'}});
 assert.equal(a.state,'capacity-quoted');
 assert.equal(b.state,'capacity-quoted');
 const after={...c,book:{...c.book,revision:'journal:5',claims:[...c.book.claims,a.saleReservation]},
   sale:{...c.sale,actor:'b',intentId:'b'}};
 assert.equal(quote(after).state,'sold-out');
});

test('disconnected but otherwise normal Lightning channel contributes zero usable sales capacity',()=>{
 const observation=project({result:{channels:[
  {state:'CHANNELD_NORMAL',peer_connected:false,spendable_msat:'100000000msat'},
  {state:'CHANNELD_NORMAL',peer_connected:true,spendable_msat:'200000msat'},
 ]},walletId:'node-1',network:'regtest',observedAt:'2026-10-17T23:00:00Z',sourceRef:'urn:cln:receipt'});
 assert.equal(observation.spendableOutboundMsat,'200000');
});
