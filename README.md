# Capability Pricing Service

Source owner: Red Cup Engineering. Quotes and ranks same-denomination offers,
using explicit costs and recorded outcomes. Contact admission and measured
economic ATT are distinct contracts; neither is manufactured by this service.

## Run the existing HTTP service

`npm test` runs the source-owned regression tests. `npm start` serves
`GET /health`, `POST /quote`, `POST /rank`, and `POST /observe`.
`HOST` defaults to `0.0.0.0`, and `PORT` defaults to `19860`.
Set `HOST=127.0.0.1` for loopback-only installations.

`POST /rank` uses only the service's locally retained observation history
(`PRICE_OBSERVATIONS_PATH`, default `data/observations.jsonl`). It refuses
a request containing an `observations` member: the caller cannot replace the
receiving history with favorable self-reported results. It returns an explicit
`assurance` indicating that recorded outcomes are *authenticated-writer
claims*, not independently proved ACKs or ATT events.

### Observation ingest (explicitly configured, disabled by default)

The writer's identity and token come from the hosting secret/configuration
provider, **never** from a request body:

- `PRICE_OBSERVATION_WRITE_TOKEN`: random, high-entropy bearer secret, at
  least 32 UTF-8 bytes. Do not put it in Git, public examples, or URL strings.
- `PRICE_OBSERVATION_WRITER`: authenticated receiving office/actor identifier,
  distinct from the observed provider.
- `PRICE_OBSERVATIONS_PATH`: writable, access-controlled JSONL custody
  location; each recorded claim includes server-assigned `observedAt`.

A configured writer submits `Authorization: Bearer <secret>` to
`POST /observe` with a JSON record such as:

```json
{
  "observationId": "receiving/case-123",
  "provider": "provider-A",
  "taskClass": "independent-source-review",
  "outcome": "verified",
  "evidenceRef": "urn:receiving:case-123:receipt"
}
```

The service authorizes the writer with a constant-time digest comparison,
rejects caller-authored observer identity or timestamps, validates and
attributes the evidence reference, and serializes observation appends within
this **single service process**. Repeated identical `observationId` requests
return the existing result; conflicting reuses are refused. Missing or weak
writer configuration disables the write endpoint rather than admitting
anonymous `verified` events.

Legacy or malformed JSONL records and duplicate observation identifiers
cause rankings to refuse. Preserve any old history separately, then admit
its records through the configured receiving office with independently
sourced evidence; **do not** relabel old untrusted rows as verified in place.

## Qualification boundary

The bearer proves knowledge of an ingress credential, not whether the claim
is true. A non-empty `evidenceRef` is a provenance locator, **not** a verified
signature, an economic WIT, an independent receiver ACK, a second-order
ATT (WIT-of-ACK), an exchange, or settlement. These require independently
qualified actors, exact claim/crossing identity, and a receiving process
outside this pricing service. `attention-admission` quotes interruption
milliseconds only; it is not ATT or a durable atomic reservation.

The JSONL writer's serial queue covers concurrency inside **one Node
process**, not cross-process, multi-host, or crash-safe atomicity.
A production multi-writer installation must provide single-writer custody
or a transactional shared store before relying on these observations.
TLS termination, token provisioning/rotation, authenticated receiving and
installed customer receiving must be separately demonstrated. A GitHub
source commit or green local test is not itself production installation.
