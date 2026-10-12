import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { each, put } from "@red-cup-engineering/semiotic-eavt-services-section/store";

/** The store type price observations are kept under; each is held with the instant `at` it was recorded. */
const OBSERVATION_TYPE = "price-observation";

/** The journal an observations path names: `observations.jsonl` keeps its observations at `observations.journal`. */
export const observationJournalRoot = (observationsPath) => `${resolve(observationsPath).replace(/\.jsonl$/u, "")}.journal`;

/**
 * Price observations kept in the one log: a semiotic-eavt store beside the observations path, each
 * observation held with the instant it was recorded at (strictly increasing, so the order is append
 * order) and read back in that order.
 */
export function openObservationJournal(observationsPath, { now = () => new Date() } = {}) {
  const root = observationJournalRoot(observationsPath);
  mkdirSync(root, { recursive: true });
  const held = () => [...each(root, OBSERVATION_TYPE, { strict: true })].map(({ record }) => record)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let last = held().reduce((latest, row) => Math.max(latest, Date.parse(row.at)), 0);
  const stamp = () => { last = Math.max(now().getTime(), last + 1); return new Date(last).toISOString(); };
  return Object.freeze({
    root,
    append: (observation) => { put(root, OBSERVATION_TYPE, { at: stamp(), observation }); return observation; },
    observations: () => held().map(({ observation }) => structuredClone(observation)),
  });
}
