import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observationJournalRoot, openObservationJournal } from "../src/observation-journal.mjs";

test("price observations are kept in the one log, in the order they were recorded", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capability-pricing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "observations.jsonl");
  const journal = openObservationJournal(path, { now: () => new Date("2026-10-10T00:00:00.000Z") });
  const earlier = { provider: "urn:p:a", taskClass: "t", outcome: "verified", observedAt: "2026-10-01T00:00:00.000Z" };
  const next = { provider: "urn:p:a", taskClass: "t", outcome: "refused", observedAt: "2026-10-10T00:00:00.000Z" };
  journal.append(earlier);
  journal.append(next);
  journal.append(next);
  assert.deepEqual(journal.observations(), [earlier, next, next]);
  assert.equal(existsSync(path), false);
  assert.deepEqual(openObservationJournal(path).observations(), [earlier, next, next]);
  assert.equal(existsSync(join(observationJournalRoot(path), ".lock")), false);
});
