#!/usr/bin/env node
import { createHttpServer } from "@red-cup-engineering/http-services-section/node-server";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  quoteReservationPrice,
  rankExpectedResolutionPrices,
} from "../src/pricing.mjs";
import { openObservationJournal } from "../src/observation-journal.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const observationsPath = process.env.PRICE_OBSERVATIONS_PATH ?? resolve(root, "data/observations.jsonl");
// Container schedulers route to the workload interface. Local installations
// that require loopback confinement declare HOST=127.0.0.1 explicitly.
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 19860);

async function json(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Observations are kept in the one log, a journal beside PRICE_OBSERVATIONS_PATH; a JSONL file an
// earlier release left there is admitted once.
const journal = openObservationJournal(observationsPath);
const observations = async () => journal.observations();

function send(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

createHttpServer({ handle: async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && request.url === "/rank") {
      const demand = await json(request);
      const history = demand.observations ?? await observations();
      send(response, 200, { ok: true, result: rankExpectedResolutionPrices({ ...demand, observations: history }) });
      return;
    }
    if (request.method === "POST" && request.url === "/quote") {
      send(response, 200, { ok: true, result: quoteReservationPrice(await json(request)) });
      return;
    }
    if (request.method === "POST" && request.url === "/observe") {
      const observation = await json(request);
      if (typeof observation.provider !== "string" || typeof observation.taskClass !== "string" || !["verified", "refused"].includes(observation.outcome)) {
        send(response, 400, { ok: false, refusal: { code: "invalid-observation" } });
        return;
      }
      const record = { ...observation, observedAt: observation.observedAt ?? new Date().toISOString() };
      journal.append(record);
      send(response, 201, { ok: true, observation: record });
      return;
    }
    send(response, 404, { ok: false, refusal: { code: "not-found" } });
  } catch (error) {
    send(response, 400, { ok: false, refusal: { code: "invalid-demand", message: error instanceof Error ? error.message : String(error) } });
  }
} }).listen(port, host, () => process.stdout.write(`http://${host}:${port}\n`));
