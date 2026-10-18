import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const CLI=resolve('scripts/quote-regtest-lightning-inventory.mjs');
async function withHarness(fn){
 const dir=await mkdtemp(join(tmpdir(),'yabcm-regtest-'));
 const bin=join(dir,'bin');await mkdir(bin);
 const cln=join(bin,'lightning-cli');
 await writeFile(cln,[
  '#!/usr/bin/env node',
  "if(!process.argv.includes('--regtest')||!process.argv.includes('listpeerchannels')) process.exit(3);",
  "process.stdout.write(JSON.stringify({channels:[{state:'CHANNELD_NORMAL',spendable_msat:'9000000msat'}]}));"
 ].join('\n')+'\n');
 await chmod(cln,0o700);
 const book=join(dir,'book.json'), sale=join(dir,'sale.json');
 const walletId='regtest-one';
 const write=async(maxRewardSats='2000')=>{
  await writeFile(book,JSON.stringify({walletId,revision:'regtest:1',otherCommittedMsat:'1000000',claims:[]}));
  await writeFile(sale,JSON.stringify({walletId,intentId:'buyer:1',actor:'buyer',termsRef:'urn:regtest:one-day',maxRewardSats,maxRoutingFeeSats:'100'}));
 };
 await write();
 const run=async(args=[])=>{
  try{
   const r=await exec(process.execPath,[CLI,'--ledger',book,'--sale',sale,'--wallet-id',walletId,'--reserve-msat','500000',...args],{
    cwd:resolve('.'),timeout:10000,
    env:{...process.env,PATH:bin+':'+process.env.PATH,CLN_LIGHTNING_DIR:join(dir,'cln')}
   });
   return {code:0,json:JSON.parse(r.stdout)};
  }catch(error){
   return {code:error.code,stderr:error.stderr,stdout:error.stdout};
  }
 };
 try{await fn({dir,run,write,book,sale})}finally{await rm(dir,{recursive:true,force:true})}
}
test('regtest CLI consumes live CLN spendable data and current book without paying',async()=>{
 await withHarness(async({run})=>{
  const out=await run();
  assert.equal(out.code,0);
  assert.equal(out.json.walletObservation.network,'regtest');
  assert.equal(out.json.walletObservation.spendableOutboundMsat,'9000000');
  assert.equal(out.json.quote.state,'capacity-quoted');
  assert.equal(out.json.quote.saleReservation.maxRemainingRewardMsat,'2000000');
  assert.equal(out.json.assurance,'regtest-only-no-atomic-commit-no-real-money');
 });
});
test('CLI refuses sale beyond actually spendable regtest capacity',async()=>{
 await withHarness(async({run,write})=>{
  await write('10000');
  const out=await run();
  assert.equal(out.code,2);
  assert.equal(JSON.parse(out.stdout).quote.state,'sold-out');
 });
});
test('missing authoritative wallet book cannot be replaced with invented zero obligations',async()=>{
 await withHarness(async({run,book})=>{
  await rm(book);
  const out=await run();
  assert.equal(out.code,2);
  assert.match(out.stderr,/ENOENT/);
 });
});
test('CLI refuses extra or unexpected options',async()=>{
 await withHarness(async({run})=>{
  const out=await run(['--invalid','yes']);
  assert.equal(out.code,2);
  assert.match(out.stderr,/four explicit argument pairs/);
 });
});
