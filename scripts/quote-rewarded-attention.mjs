#!/usr/bin/env node
import { quoteRewardedAttentionUnit } from '../src/rewarded-attention.mjs';

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const demand = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(JSON.stringify({ok:true, result:quoteRewardedAttentionUnit(demand)}) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ok:false, refusal:{
    code:'unquotable-reward-or-growth-budget',
    message:error instanceof Error ? error.message : String(error),
  }}) + '\n');
  process.exitCode=2;
}
