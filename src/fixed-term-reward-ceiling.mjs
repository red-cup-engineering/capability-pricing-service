import {assessPrefundedLightningSale} from './prefunded-lightning-inventory.mjs';
/**
 * Turn one externally SOURCE-AUTHORED, finite reward contract into its exact
 * worst-case obligation before a Lightning wallet is asked to back it.
 * No signing, admission, booking, or actual network mining occurs here.
 */
const MAX_MSAT_DIGITS=32;
function natural(v,label){
 if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/u.test(v)||v.length>MAX_MSAT_DIGITS)
  throw new TypeError(label+' must be an exact nonnegative millisatoshi string');
 return BigInt(v);
}
function integer(v,label,max){
 if(!Number.isSafeInteger(v)||v<0||v>max)throw new TypeError(label+' must be a bounded integer');
 return BigInt(v);
}
function tag(v,label){
 if(typeof v!=='string'||!v.trim()||v.length>512)throw new TypeError(label+' must be a source identifier');
 return v;
}
const ceil=(a,b)=>(a+b-1n)/b;
/**
 * Terms have to arrive from the original seller's authoritative catalog,
 * never a browser-selected reduced liability limit. The caller must check
 * the exact source version, agreement and product authority outside this pure function.
 */
export function compileFixedTermRewardCeiling(terms){
 const termsRef=tag(terms?.termsRef,'termsRef');
 const planId=tag(terms?.planId,'planId');
 const durationSeconds=integer(terms.durationSeconds,'durationSeconds',366*86400);
 if(!durationSeconds)throw new TypeError('term duration must be positive and finite');
 const msatPerHour=natural(terms.maxBaseRewardMsatPerHour,'maxBaseRewardMsatPerHour');
 const boostBps=integer(terms.maxTotalMultiplierBps,'maxTotalMultiplierBps',1000000);
 if(boostBps<10000n)throw new TypeError('maximum aggregate multiplier must be >=1.00x');
 const extra=natural(terms.maxExtraBonusMsat,'maxExtraBonusMsat');
 const maxWithdrawals=integer(terms.maxWithdrawals,'maxWithdrawals',1024);
 if(maxWithdrawals<1n)throw new TypeError('at least one payout event must be budgeted');
 const feePerWithdrawal=natural(terms.maxRoutingFeeMsatEach,'maxRoutingFeeMsatEach');
 const baseCeiling=ceil(msatPerHour*durationSeconds*boostBps,3600n*10000n);
 const rewardCeiling=baseCeiling+extra;
 if(rewardCeiling<=0n)throw new Error('positive real-reward contract needs an actual finite upper reward');
 const feeCeiling=feePerWithdrawal*maxWithdrawals;
 const total=rewardCeiling+feeCeiling;
 return Object.freeze({
  kind:'FixedTermRewardCeiling.v1',termsRef,planId,
  durationSeconds:durationSeconds.toString(),
  maximumAggregateMultiplierBps:boostBps.toString(),
  maxRewardMsat:rewardCeiling.toString(),
  maxRoutingFeeMsat:feeCeiling.toString(),
  requiredPrefundMsat:total.toString(),
  maxRewardSatsCeil:ceil(rewardCeiling,1000n).toString(),
  maxRoutingFeeSatsCeil:ceil(feeCeiling,1000n).toString(),
  caution:'Scenario ceiling only; quote requires trusted terms and live book/wallet read. No rewards or purchase authorized.'
 });
}
/** Prepare a capacity quote with a ceiling derived from immutable plan rules.
 * Use a real single-writer book to commit its prospective reservation before sale.
 */
export function quoteFundedFixedTerm({wallet,book,terms,actor,intentId,policy}={}){
 const ceiling=compileFixedTermRewardCeiling(terms);
 const q=assessPrefundedLightningSale({
  wallet,book,sale:{
   walletId:wallet?.id,actor,intentId,termsRef:ceiling.termsRef,unit:"msat",
   maxRewardMsat:ceiling.maxRewardMsat,
   maxRoutingFeeMsat:ceiling.maxRoutingFeeMsat,
  },policy,
 });
 return Object.freeze({ceiling,capacity:q,acceptedSale:false,
  note:'A fitting quote is not a financial booking. Atomic expected-revision reservation is required before payment.'});
}
