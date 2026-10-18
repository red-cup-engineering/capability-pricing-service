#!/usr/bin/env node
/**
 * REGTEST-ONLY developer reader. It never receives an HTTP request, signs
 * payments, takes a buyer's funds or commits the quoted booking.
 * Requires an explicitly selected locally running Core Lightning RPC node.
 *
 * Usage (operator-controlled data; not customer input):
 *   node scripts/quote-regtest-lightning-inventory.mjs \
 *      --ledger /private/path/book.json --sale /private/path/sale.json \
 *      --wallet-id payout-regtest-node --reserve-msat 1000000
 *
 * The ledger is read-only. It MUST already contain all *other* obligations
 * sharing the wallet. Never synthesize an empty book upon a missing file.
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assessPrefundedLightningSale, projectCoreLightningOutbound}
  from '../src/prefunded-lightning-inventory.mjs';

const execute=promisify(execFile);
const argumentsMap=Object.fromEntries(process.argv.slice(2).reduce((pairs,token,i,all)=>{
  if(i%2===0) pairs.push([token,all[i+1]]);
  return pairs;
},[]));
const requireOption=(key)=>{
 const value=argumentsMap[key];
 if(typeof value!=='string'||!value.trim())throw new Error('missing operator argument '+key);
 return value;
};
async function main(){
 const [ledgerPath,salePath,walletId,reserveMsat]=[
  '--ledger','--sale','--wallet-id','--reserve-msat'].map(requireOption);
 if(!/^(0|[1-9][0-9]*)$/u.test(reserveMsat))throw new TypeError('reserve-msat must be an exact nonnegative integer');
 if(process.argv.length!==10)throw new Error('only four explicit argument pairs are permitted');
 const book=JSON.parse(await readFile(resolve(ledgerPath),'utf8'));
 const sale=JSON.parse(await readFile(resolve(salePath),'utf8'));
 const clnArgs=['--regtest'];
 // The node owner selects its own CLN directory, never the buyer.
 if(process.env.CLN_LIGHTNING_DIR)clnArgs.push('--lightning-dir='+process.env.CLN_LIGHTNING_DIR);
 clnArgs.push('listpeerchannels');
 const {stdout}=await execute('lightning-cli',clnArgs,{timeout:8000,maxBuffer:1024*1024});
 const observedAt=new Date().toISOString();
 const wallet=projectCoreLightningOutbound({
  result:JSON.parse(stdout),walletId,network:'regtest',observedAt,
  sourceRef:'urn:cln:regtest:listpeerchannels:'+observedAt
 });
 const quote=assessPrefundedLightningSale({
  wallet,book,sale,policy:{
   network:'regtest',asOf:new Date().toISOString(),
   maxSnapshotAgeMs:15000,liquiditySafetyReserveMsat:reserveMsat
  }
 });
 process.stdout.write(JSON.stringify({walletObservation:wallet,quote,assurance:'regtest-only-no-atomic-commit-no-real-money'},null,2)+'\n');
 if(quote.state!=='capacity-quoted')process.exitCode=2;
}
main().catch(error=>{
 process.stderr.write(JSON.stringify({ok:false,refusal:{
  code:'regtest-capacity-unavailable',
  message:error instanceof Error?error.message:String(error)
 }})+'\n');
 process.exitCode=2;
});
