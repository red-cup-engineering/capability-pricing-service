/**
 * Attention admission for accountable agent dispatch.
 * Attention is a non-transferable, audience-scoped scarce resource, never
 * silently interchangeable with money, CPU, or model tokens.
 * Pure decision: the caller must atomically persist the returned reservation
 * under its idempotency key before dispatching any notification.
 */
export function assessAttentionAdmission({ request, budget, reservations = [] }) {
  const natural = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(label + " must be a nonnegative safe integer");
    return value;
  };
  const key = (value, label) => {
    if (typeof value !== "string" || !value.trim())
      throw new TypeError(label + " must be a nonempty string");
    return value;
  };
  const audience = key(request?.audience, "request.audience");
  const requestId = key(request?.id, "request.id");
  const actor = key(request?.actor, "request.actor");
  const purpose = key(request?.purpose, "request.purpose");
  const scope = key(budget?.audience, "budget.audience");
  if (scope !== audience) throw new Error("cross-audience attention budget");
  const capacity = natural(budget.capacityMillis, "budget.capacityMillis");
  const cost = natural(request.attentionMillis, "request.attentionMillis");
  const consent = request.consent === true;
  const protectedReserve = natural(budget.protectedReserveMillis ?? 0, "budget.protectedReserveMillis");
  if (protectedReserve > capacity) throw new Error("reserve exceeds capacity");
  if (!Array.isArray(reservations)) throw new TypeError("reservations must be an array");
  const seen = new Set();
  let committed = 0;
  let previous = null;
  for (const [index, row] of reservations.entries()) {
    const id = key(row?.id, "reservations[" + index + "].id");
    if (seen.has(id)) throw new Error("duplicate reservation id");
    seen.add(id);
    if (key(row.audience, "reservation.audience") !== audience)
      throw new Error("cross-audience reservation");
    const amount = natural(row.attentionMillis, "reservation.attentionMillis");
    if (committed > Number.MAX_SAFE_INTEGER - amount) throw new Error("attention sum overflow");
    committed += amount;
    if (id === requestId) previous = row;
  }
  if (committed > capacity) throw new Error("existing reservations exceed capacity");
  const available = capacity - committed - protectedReserve;
  const basis = {audience, actor, purpose, requestId, attentionMillis:cost};
  if (previous) {
    if (previous.attentionMillis !== cost || previous.actor !== actor || previous.purpose !== purpose)
      throw new Error("idempotency key reused with different attention obligation");
    return Object.freeze({kind:"AttentionAdmission.v1", status:"already-reserved", basis, remainingMillis:Math.max(0,available)});
  }
  const status = !consent ? "consent-required" : cost > available ? "insufficient-attention" : "admissible";
  return Object.freeze({
    kind:"AttentionAdmission.v1", status, basis,
    remainingMillis:Math.max(0,available),
    reservation:status === "admissible" ? Object.freeze({id:requestId, audience, actor, purpose, attentionMillis:cost}) : null,
    note:"Admission is not settlement: commit the reservation with a unique constraint before dispatch."
  });
}
