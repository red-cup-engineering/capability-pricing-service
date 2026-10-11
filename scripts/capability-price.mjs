#!/usr/bin/env node
import { rankExpectedResolutionPrices } from "../src/pricing.mjs";

const refusalCode = (error) => {
  if (/cross-denomination/u.test(error.message)) return "cross-denomination";
  if (/positive finite/u.test(error.message)) return "invalid-consideration";
  return "invalid-demand";
};

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const demand = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const result = rankExpectedResolutionPrices(demand);
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    refusal: {
      code: refusalCode(error),
      message: error instanceof Error ? error.message : String(error),
    },
  })}\n`);
  process.exitCode = 2;
}
