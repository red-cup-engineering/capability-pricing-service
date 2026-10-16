#!/usr/bin/env node
import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authorizeObservationWriter, admitObservationClaim } from "../src/observation-boundary.mjs";
import {
  quoteReservationPrice,
  rankExpectedResolutionPrices,
} from "../src/pricing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const observationsPath = process.env.PRICE_OBSERVATIONS_PATH ?? resolve(root, "data/observations.jsonl");
// Container schedulers route to the workload interface. Local installations
// that require loopback confinement declare HOST=127.0.0.1 explicitly.
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 19860);
const observationWriteSecret = process.env.PRICE_OBSERVATION_WRITE_TOKEN;
const observationWriter = process.env.PRICE_OBSERVATION_WRITER;
// Serialize append decisions within this one server process. Cross-process
// atomicity and independent receiver verification remain deployment duties.
let observationWriteTail = Promise.resolve();

async function json(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw new Error("request exceeds 64KiB JSON limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function observations() {
  try {
    const text = await readFile(observationsPath, "utf8");
    const rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (rows.some(row => row?.kind !== "CapabilityPricingOutcomeClaim.v1" ||
        row.assurance !== "authenticated-writer-claim-not-independent-ACK-or-ATT" ||
        typeof row.observationId !== "string" || typeof row.evidenceRef !== "string")) {
      throw new Error("stored outcome history is not in the authenticated-claim format");
    }
    return rows;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function send(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && request.url === "/rank") {
      const demand = await json(request);
      if (Object.hasOwn(demand, "observations")) {
        send(response, 400, {ok:false, refusal:{code:"caller-observation-history-not-authoritative"}});
        return;
      }
      const history = await observations();
      send(response, 200, { ok: true, result: rankExpectedResolutionPrices({ ...demand, observations: history }),
        assurance: "authenticated-writer-claims-only-not-independent-ACK-or-ATT" });
      return;
    }
    if (request.method === "POST" && request.url === "/quote") {
      send(response, 200, { ok: true, result: quoteReservationPrice(await json(request)) });
      return;
    }
    if (request.method === "POST" && request.url === "/observe") {
      const authority = authorizeObservationWriter({
        authorization: request.headers.authorization,
        secret: observationWriteSecret,
        writer: observationWriter,
      });
      if (!authority.ok) {
        send(response, authority.status, {ok:false, refusal:{code:authority.code}});
        return;
      }
      const record = admitObservationClaim(await json(request), {
        writer: authority.writer, observedAt: new Date().toISOString(),
      });
      const write = observationWriteTail.then(async () => {
        const history = await observations();
        const existing = history.find(row => row.observationId === record.observationId);
        if (existing !== undefined) {
          if (["provider", "taskClass", "outcome", "evidenceRef", "observedBy"]
              .some(key => existing[key] !== record[key])) {
            throw new Error("observation identity reused with different evidence");
          }
          return {status:200, record:existing, replay:true};
        }
        await mkdir(dirname(observationsPath), {recursive:true});
        await appendFile(observationsPath, JSON.stringify(record) + "\n",
          {encoding:"utf8", mode:0o600});
        return {status:201, record, replay:false};
      });
      observationWriteTail = write.then(() => undefined, () => undefined);
      const result = await write;
      send(response, result.status, {ok:true, observation:result.record, replay:result.replay});
      return;
    }
    send(response, 404, { ok: false, refusal: { code: "not-found" } });
  } catch (error) {
    send(response, 400, { ok: false, refusal: { code: "invalid-demand", message: error instanceof Error ? error.message : String(error) } });
  }
}).listen(port, host, () => process.stdout.write(`http://${host}:${port}\n`));
