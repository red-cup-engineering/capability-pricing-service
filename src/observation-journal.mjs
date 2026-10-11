import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { admitJsonlOnce, readAdmittingJsonl } from "@red-cup-engineering/semiotic-eavt-services-section/admit-jsonl-once";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

/** The kind price observations are kept under in the one log. */
export const PRICE_OBSERVATION_OBJECT_KIND = "capability-pricing.observation";
const OBSERVATION = "observation";
const HELD = Object.freeze({ for: true, against: false });

/** The journal an observations path names: `observations.jsonl` keeps its observations at `observations.journal`. */
export const observationJournalRoot = (observationsPath) => `${resolve(observationsPath).replace(/\.jsonl$/u, "")}.journal`;

/**
 * Price observations kept in the one log: a semantic-record journal beside the observations path,
 * read back in append order. A JSONL file of observations an earlier release left at the path is
 * admitted once, read only, skipping observations already held; `jsonl-admission.json` in the
 * journal marks that so it never repeats.
 */
export function openObservationJournal(observationsPath, { now = () => new Date() } = {}) {
  const root = observationJournalRoot(observationsPath);
  mkdirSync(root, { recursive: true });
  const journal = createSemanticRecordJournal({ root, objectKind: PRICE_OBSERVATION_OBJECT_KIND });
  const held = () => journal.query({ category: OBSERVATION }).filter((row) => row.told?.for && !row.told?.against);
  let last = held().reduce((latest, row) => Math.max(latest, Date.parse(row.recordedAt)), 0);
  const stamp = () => { last = Math.max(now().getTime(), last + 1); return new Date(last).toISOString(); };
  const append = (observation) => journal.record({ category: OBSERVATION, record: observation, recordedAt: stamp(), told: HELD });
  const book = { root, record: (category, observation) => append(observation), read: () => held().map((row) => row.record) };
  const sources = [{ path: observationsPath, category: OBSERVATION }], identity = (observation) => JSON.stringify(observation);
  admitJsonlOnce(book, sources, { identity, type: "PriceObservationJsonlAdmission", from: resolve(observationsPath), mode: 0o600 });
  return Object.freeze({
    root,
    append: (observation) => { append(observation); return observation; },
    observations: () => readAdmittingJsonl(book, sources, OBSERVATION, { identity }).map((observation) => structuredClone(observation)),
  });
}
