import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observationJournalRoot, openObservationJournal } from "../src/observation-journal.mjs";

test("price observations are kept in the one log; a JSONL left by an earlier release is admitted once and left unchanged", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capability-pricing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "observations.jsonl");
  const earlier = { provider: "urn:p:a", taskClass: "t", outcome: "verified", observedAt: "2026-10-01T00:00:00.000Z" };
  const legacy = `${JSON.stringify(earlier)}\n`;
  writeFileSync(path, legacy);
  const journal = openObservationJournal(path, { now: () => new Date("2026-10-10T00:00:00.000Z") });
  const next = { provider: "urn:p:a", taskClass: "t", outcome: "refused", observedAt: "2026-10-10T00:00:00.000Z" };
  journal.append(next);
  journal.append(next);
  assert.deepEqual(journal.observations(), [earlier, next, next]);
  assert.equal(readFileSync(path, "utf8"), legacy);
  assert.ok(existsSync(join(observationJournalRoot(path), "jsonl-admission.json")));
  assert.deepEqual(openObservationJournal(path).observations(), [earlier, next, next]);
  assert.equal(existsSync(join(observationJournalRoot(path), ".lock")), false);
});
