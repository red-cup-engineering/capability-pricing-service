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

## Rewarded-attention unit economics (no reward issuance)

The pricing owner exports `./rewarded-attention`, `quoteRewardedAttentionUnit(input)`, and the `quote-rewarded-attention-unit` command (JSON request on stdin). These produce **scenarios only**: no advertiser approval, conversion verification, collected cash, reserve booking, BTC conversion, customer acquisition spend, wallet custody or end-user payout.

Owning consumer [Causeway Public Services #64](https://github.com/causeway-services/public-services-section/issues/64); media acquisition [#53](https://github.com/causeway-services/public-media-services-section/issues/53); [Group Opportunity #34](https://github.com/561-group/561-group-opportunity-services-section/issues/34). One player's monetizable attention may create Group cash margin that pays for advertisements bringing other players. No player-to-player transfers, recruitment deposits, or income guaranteed by later signups. **House promotions have zero outside cash revenue**, although they may attract visitors to other Group products.

### Synthetic worked input — not a supplier quote or current BTC rate

```json
{
  "channel": "sponsored",
  "offer": {
    "provider": "example-only",
    "sourceRef": "urn:unverified:example-offer",
    "state": "quoted",
    "publisherPayoutUsd": "0.100000"
  },
  "costs": {
    "deliveryUsd": "0.005000",
    "reversalReserveUsd": "0.020000",
    "withdrawalFeeReserveUsd": "0.005000",
    "supportComplianceUsd": "0.010000"
  },
  "policy": {
    "acquisitionTargetUsd": "0.020000",
    "retainedMarginUsd": "0.010000"
  },
  "funding": {
    "unencumberedClearedUsd": "1.000000"
  },
  "btcQuote": {
    "sourceRef": "urn:unverified:example-btc-quote",
    "observedAt": "2026-10-17T22:00:00Z",
    "usdPerBtc": "100000.00"
  }
}
```

At these entirely invented rates, the upper bound is **30 sats** in possible reward plus **$0.02** in separately proposed advertising acquisition allocation, after all specified costs and the retained margin floor. Actual rewards are **not** issued by a price quotation, and the source named above is deliberately unverified.

**Required independent facts:** actual partner-approved rewarded traffic and payout terms; attributed signed conversion; reversals; conservative reserves; wallet and Lightning fees; reconciled **cleared unencumbered cash**; observed dated BTC/USD price; spend authority; retention and conservative after-cost contribution LTV versus independently measured acquisition cost. If a cost or cash input is unknown, the quote refuses instead of silently substituting zero. A missing BTC price produces only a USD envelope, not a sat promise. Sub-sat reward value is floored to zero.

**Stage separation:** advertiser quote → eligible conversion → provider receivable → collected cash; player reward terms → verified/guaranteed obligation → wallet payout; acquisition allocation → authorized external campaign spend → observed new-user cohort. These are distinct economic resources. The calculator neither supplies atomic cash reservations nor authenticates advertiser payouts, so no public consumer may interpret its scenario as a real earning, revenue settlement, funded acquisition campaign or verified profit.

## Pre-funded Lightning reward inventory and regtest

The 561 Group can sell real-sat virtual miner terms **only up to pre-funded payout capacity**. Unlike an app-only demonstration, each real paid day/week/year contract and any *qualifying* rewarded ad must reserve its **maximum possible** sat liability, including all permitted multiplier effects and a conservative outgoing Lightning fee allowance, *before* promising rewards. Claiming an 8-hour free plan is a separate new obligation at each claim; recurring subscriptions must renew only after a new, fully covered reservation. Never count present purchase receipts, advertising receivables, future new players, or unconverted x402 USDC as currently spendable BTC.

Pure reusable quote provider: `./prefunded-lightning-inventory`, exporting `assessPrefundedLightningSale` and `projectCoreLightningOutbound`. The former checks **exact millisatoshi integer strings** against a source-identified Lightning snapshot, complete unsettled booking entries, obligations on the same wallet from other business functions, and liquidity safety reserve. Wallet/book identities and regtest/signet/mainnet network must match. Stale snapshots, missing obligations/fees, duplicate identities, unknown statuses, disconnected channels, zero spendable outgoing liquidity and mismatched wallet IDs refuse or return unavailable. It does not establish ownership or authority of the caller-supplied snapshot.

The projection reads Core Lightning `listpeerchannels` output; only connected `CHANNELD_NORMAL` channels contribute `spendable_msat`. The upstream estimate can still overstate actual payment routing, so conservative safety reserves and receipt/reconciliation are mandatory. It **does not** count inbound capacity, onchain UTXOs, disconnected peers, pending receipt from ad networks, or unconfirmed purchase proceeds as outgoing payment inventory. Reference: https://docs.corelightning.org/reference/listpeerchannels .

### Runnable development path: Lightning regtest

Use the [Core Lightning local regtest instructions](https://docs.corelightning.org/docs/developers-guide), including `contrib/startup_regtest.sh`, `start_ln 3` and `fund_nodes`, or [Polar](https://docs.lightning.engineering/lightning-network-tools/taproot-assets/polar) for locally connected regtest nodes. Both use valueless simulated BTC. Use separate payer/recipient CLN nodes to rehearse channel movement, routing fees, failed invoices and confirmation; the pure quote alone does **not** pay anyone.

An authenticated operator on the machine running the **regtest** Core Lightning daemon can run this strictly read-only CLI:

```sh
node scripts/quote-regtest-lightning-inventory.mjs \
  --ledger /private/authoritative/book.json \
  --sale /private/authorized/one-sale-intent.json \
  --wallet-id payout-regtest-node \
  --reserve-msat 1000000
```

The operator's book must exist and include **all** obligations sharing the node. Its `revision` is the expected atomic journal revision for any later booking. For example, a deliberately illustrative *not-authoritative* book is:

```json
{
  "walletId": "payout-regtest-node",
  "revision": "regtest:example-1",
  "otherCommittedMsat": "0",
  "claims": []
}
```

And an illustrative *unexecuted* fixed-maximum sale request:

```json
{
  "walletId": "payout-regtest-node",
  "actor": "example-customer",
  "intentId": "illustrative-one",
  "termsRef": "urn:561:yabcm:example-fixed-8-hour-bounded-boost-ceiling",
  "maxRewardSats": "2000",
  "maxRoutingFeeSats": "100"
}
```

**The output is a QUOTE, not a booking or user authorization.** Its field `capacityFits` explicitly does **not** authorize a real sale. No live wallet, account balance, external CLN payment, permission, or mainnet release was received in this source change. Test suite includes exact-price and replay/refusal cases and a synthetic executable `lightning-cli` stub; testing a stub is not testing a real LN channel.

### Required transaction and payout receiver before live purchases

One ledger owner/transaction boundary must atomically check current ledger revision, independently received spendable LN funds, and *all* existing max lifetime obligations, then commit **one idempotent reservation**. Only after that can a separately authorized product accept a charge; if charging fails, release only upon an independently known cancelled/unpaid/fully refunded status. Hold unresolved outcomes. When credits accrue, move already reserved value from future-contract to earned-withdrawable classification without double counting or expanding the total obligation. On payout, keep the claim in-flight until the wallet confirms finality and the ledger has reconciled the spend plus routing fee; never free the reserve on a client click or sent-only state. Fund shortfalls suspend new offers **and** require repairing/covering outstanding promises; merely hiding the buy button cannot satisfy existing customers. Do not modify recurring scheduled tasks for this.

**Customer-facing design:** `sold-out` or `payout capacity unavailable` when free reserves cannot cover the entire promised contract, while the existing *unpaid* demo and house promotions may remain playable. Discount promotions and loyalty boosts must have an enforceable maximum per purchase; the market can never promise an unbounded future multiplier. No balances derived from tiny 14-decimal BTC animations count as withdrawable sats until the actual ledger and Lightning payout unit are matched.

Original consumer: [Causeway Public Services #64](https://github.com/causeway-services/public-services-section/issues/64). The next state-changing Engineering edge is an atomic booking and reconciliation path in the *original financial ledger/treasury owner*, not a parallel reward database invented by a web page. This module is a new source-only pricing/coverage check and does not supersede `./rewarded-attention` advertiser unit economics.


## Millisatoshi exactness for finite digital reward contracts

[Source-verified Lenticule competitor study](https://github.com/lenticule-science/economic-intelligence-research-service/blob/main/research/market-science/2026-10-17-reward-miner-competitive-reconstruction.md): one typical eight-hour free CloudMineCrypto display can project **less than one sat** under the provider's published simplified hashrate/index formula. A pricing engine that automatically rounds **each** such claim up to a full sat before reserving payout funds creates an artificial scarcity/cost floor, although a user's withdrawable balance may only become payable after many accrued credits.

The read-only `./prefunded-lightning-inventory` export now accepts **two explicitly distinct** candidate inputs:

- Legacy `{maxRewardSats:"...", maxRoutingFeeSats:"..."}` reserves whole sats, converted to exact msat.
- Native `{unit:"msat", maxRewardMsat:"...", maxRoutingFeeMsat:"..."}` reserves exact sub-sat amounts without premature conversion.
- Mixed units, missing explicit msat marker and malformed integer quantities are rejected; wallet and outstanding booking claims are always in **exact integer msat**.

The new `./fixed-term-reward-ceiling` export produces a worst-case bound for an **authorized, finite** product: `ceil(rateMsatPerHour × durationSeconds × maximumAggregateMultiplierBps / (3600 × 10000)) + cappedExtraBonusMsat`, plus `maxWithdrawals × maxRoutingFeeMsatEach`. All product terms, including the maximum combined loyalty/boost multiplier and payout count, must be finite and source-authored. The combined `quoteFundedFixedTerm` passes these native msat limits into the existing Lightning quote. It does not establish real backing, acquire the source's authority, or create a financial contract.

**Why not floor to zero?** In the independent USD ad-event [`./rewarded-attention`](./src/rewarded-attention.mjs) example, the offered whole-sat conversion is a distinct scenario quote. At the **payout and withdrawal boundary**, a user may combine separately funded tiny msat accruals until they meet a declared invoice/minimum and fee. The journal must retain that credit precisely *without creating its own unbacked sat*. A sub-sat **projection** is not a confirmed claim; a committed msat reward is only valid with server-held backing and lawful terms.

[Source tests](test/prefunded-lightning-inventory.test.mjs) for legacy and msat inventory + [contract-ceiling tests](test/fixed-term-reward-ceiling.test.mjs) cover 21 independent assertions under in-isolate source execution. However, **the transaction writer is still absent**: two simultaneous quotes against the same uncommitted book may both fit. Before any public real-sat contract or recurring purchase, install one transactionally guarded, revision-checked, source-owned wallet+ledger booking and payout/reversal actor in the original Finance/Treasury producer. Follow [Financial Engineering #36](https://github.com/red-cup-engineering/financial-engineering-services-section/issues/36). A quote never conveys spending or custody authority.


## GPU and agent Work: compute brokerage by accepted result (2026-10-20)

**Demand:** the 561 Group Leader wants agents to buy, hire, broker and, where expressly permitted, resell compute/GPUs economically. The original receiving system is [Coesite Capability Bazaar #5](https://github.com/coesite-operations/capability-market-services-section/issues/5) and its [merged provider admission PR #11](https://github.com/coesite-operations/capability-market-services-section/pull/11); the original seller/readout faces remain [Causeway Market #19](https://github.com/causeway-services/market.561.group/issues/19) and Shop. This package **owns pricing math**, not a new market, GPU scanner, data codec, payment router or wallet.

The new `./compute-work-hiring` export and `quote-compute-work` executable both invoke the **existing** `quoteReservationPrice` exact rational arithmetic from this package. They compare source-described offers on modeled consideration **per accepted Work result** under a bounded agent Work demand. They require all **twelve** explicit cost categories, including original GPU-seconds, CPU/memory, storage, egress, startup, retries, independent verification, payment, separate brokerage, customer support, capital carry and refund reserve. Zero costs must be explicitly sourced; absent costs remain unknown. A provider with cheaper GPU time but high failure/retry risk can lose to a dearer, more reliable source. Unit rates, task-class delivery counts and delivery durations are **source assertions until independently witnessed**, not marketplace-verified facts.

The Work demand supplies a named Work/acceptance reference, GPU VRAM floor, maximum elapsed seconds, geographic data residency, preemption policy, privacy classification and **maximum all-in buyer price in a stated denomination**. Each offer needs a source URL, seller/payee identities, seller's commercial terms and allowed relationship, source observation/expiry, capabilities and measured duration, exactly matched historical acceptance task class, exact denominated price lines, margin and settlement increment. Different native AKT/NOS/USD units are refused for ranking without a separately independently source-qualified conversion; no exchange rate is inferred here.

The five **commercial modes** stay distinct:
- `direct-provider`: original seller sells directly to an admitted buyer, with no compulsory Bazaar fee.
- `noncustodial-referral`: optional finder or selection work; any nonzero brokerage fee requires a separately identified original agreement.
- `managed-result`: a Shop operator lawfully consumes third-party compute and sells independently **accepted useful outputs**, not a claim to resell raw VM inventory.
- `native-network-gateway`: a recognized protocol Gateway provides authentication, routing, consumer support and independently funded/settled supplier payments under the protocol's own economic requirements; e.g. [Livepeer inference](https://livepeer.org/) or [The Graph's Gateway](https://thegraph.com/docs/en/gateways/subgraphs/consumer-side/pricing-payments/).
- `raw-capacity-resale`: separate original sublease/right must be proved. Public GPU API visibility is not that right.

**Original-source legal boundaries:** [Vast September 2026](https://vast.ai/terms) restricts uncontracted service-bureau/comparison use; [Runpod](https://www.runpod.io/legal/terms-of-service) restricts purchasing agents and credits resale without consent; [Akash Console §10.2](https://console.akash.network/terms-of-service) restricts its proprietary Console service/material resale even though [Akash public provider indices](https://akash.network/docs/api-documentation/rest-api/) are observable and underlying on-chain leases exist. [Nosana markets](https://learn.nosana.com/api/markets.html) supply a separate on-chain job provider model subject to its original terms. This library runs **no** upstream calls, cannot authenticate documents, and never grants agency rights.

### Current scientific boundary

Output is deliberately a `ComputeWorkPriceComparison` **conditional scenario**, with `buyerOrBrokerAuthorized=false`, `liveQuoteOrSupplyVerified=false`, `completedWorkOrSettlementVerified=false`, and original observed-claim status preserved. A positive scenario means **neither** an executable GPU lease nor a received customer result nor actual paid brokerage revenue. The read-only ranking is only within one exact denomination, one Work class and the buyer's maximum budget. A separate original operation must authenticate source quote/rights, independently verify workload benchmark and actual supply, record buyer's scoped spend grant, procure through a permitted supplier, receive a checked result and settle/reconcile the original provider/customer payments.

A reproducible synthetic fixture in `test/compute-work-hiring.test.mjs` illustrates: a 60-second $0.10/s GPU with four successful results out of five **asserted** trials would conditionally cost $7.50 per accepted result, whereas an otherwise equivalent $0.05/s provider with only one accepted result in four would conditionally cost $12.00. Neither rate is a live upstream quote, neither sample is an independently authenticated history, and the comparison does not prove those platforms can accept the actual task.

Run `npm run verify` for the complete native package and syntax checks, or feed one fully source-qualified JSON request on stdin into `quote-compute-work`; the command prints the exact conditional decision structure with refusals and performs **no payment**.

