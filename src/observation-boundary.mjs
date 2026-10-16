/**
 * Capability-pricing observation ingress: authenticated writer claims,
 * NOT counterparty ACK, ATT(WIT-of-ACK), or independently verified delivery.
 * The writer's identity comes only from service configuration, never the body.
 */
import {createHash, timingSafeEqual} from "node:crypto";

const text = (value, label) => {
  if (typeof value !== "string" || value.trim().length === 0 ||
      value.length > 512 || value.includes("\u0000")) {
    throw new TypeError(label + " must be nonempty text of at most 512 characters");
  }
  return value;
};

const refusal = (status, code) => Object.freeze({ok:false, status, code});

/** Shared-secret authentication is ingress authorization, not evidence of truth. */
export function authorizeObservationWriter({authorization, secret, writer} = {}) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32 ||
      typeof writer !== "string" || !writer.trim()) {
    return refusal(503, "observation-writer-not-configured");
  }
  if (typeof authorization !== "string" || !/^Bearer [^\s]+$/u.test(authorization) ||
      authorization.length > 2048) {
    return refusal(401, "observation-writer-unauthorized");
  }
  // Fixed-length digests make comparisons constant-time even for varied tokens.
  const digest = value => createHash("sha256").update(value, "utf8").digest();
  const authorized = timingSafeEqual(digest(authorization.slice(7)), digest(secret));
  return authorized ? Object.freeze({ok:true, writer}) :
    refusal(401, "observation-writer-unauthorized");
}

/** Admit an attributed, referential claim; a receiver must verify its evidence separately. */
export function admitObservationClaim(input, {writer, observedAt} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype) {
    throw new TypeError("observation must be a plain record");
  }
  const allowed = ["observationId", "provider", "taskClass", "outcome", "evidenceRef"];
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new TypeError("observation contains unknown or caller-authored provenance fields");
  }
  const observationId = text(input.observationId, "observationId");
  const provider = text(input.provider, "provider");
  const taskClass = text(input.taskClass, "taskClass");
  const evidenceRef = text(input.evidenceRef, "evidenceRef");
  const reporter = text(writer, "trusted writer");
  const timestamp = text(observedAt, "observedAt");
  if (!["verified", "refused"].includes(input.outcome)) {
    throw new TypeError("outcome must be verified or refused");
  }
  if (provider === reporter) throw new TypeError("provider cannot be its own outcome writer");
  if (!/^(?:https:\/\/[^\s]+|ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}|urn:[^\s]+)$/u.test(evidenceRef)) {
    throw new TypeError("evidenceRef must identify an external HTTPS, NI or URN resource");
  }
  return Object.freeze({
    kind:"CapabilityPricingOutcomeClaim.v1", observationId, provider, taskClass,
    outcome:input.outcome, evidenceRef, observedBy:reporter, observedAt:timestamp,
    assurance:"authenticated-writer-claim-not-independent-ACK-or-ATT",
  });
}
