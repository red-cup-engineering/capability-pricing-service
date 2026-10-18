/**
 * Pure, fail-closed pre-funded payout inventory quote. The caller MUST use
 * trusted node/ledger input and commit the proposed reservation atomically.
 * An admissible quote is NOT an executed reservation, a purchase, or a payout.
 * Portfolio liabilities include unearned contract maxima, earned balances,
 * pending Lightning payments, routing fees and obligations of other services.
 */
export function assessPrefundedLightningSale({wallet, book, sale, policy} = {}) {
  const money = (value, label) => {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value))
      throw new TypeError(label + " must be an exact nonnegative decimal integer string");
    return BigInt(value);
  };
  const name = (value, label) => {
    if (typeof value !== "string" || value.length === 0 || !value.trim())
      throw new TypeError(label + " must identify an actual source or object");
    return value;
  };
  const utc = (value, label) => {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(value) ||
        !Number.isFinite(Date.parse(value)))
      throw new TypeError(label + " requires UTC ISO time");
    return Date.parse(value);
  };
  const walletId = name(wallet?.id, "wallet.id");
  const bookId = name(book?.walletId, "book.walletId");
  if (walletId !== bookId) throw new Error("wallet / book custody mismatch");
  const intentId = name(sale?.intentId, "sale.intentId");
  const actor = name(sale?.actor, "sale.actor");
  const termsRef = name(sale?.termsRef, "sale.termsRef");
  const revision = name(book?.revision, "book.revision");
  const walletSource = name(wallet?.sourceRef, "wallet.sourceRef");
  const network = name(wallet?.network, "wallet.network");
  const permittedNetwork = name(policy?.network, "policy.network");
  if (!["regtest", "signet", "testnet4", "mainnet"].includes(network) || network !== permittedNetwork)
    throw new Error("unauthorized Lightning network");
  if (wallet.ready !== true) throw new Error("Lightning wallet is not ready for payouts");
  const observedAt = utc(wallet.observedAt, "wallet.observedAt");
  const now = utc(policy?.asOf, "policy.asOf");
  if (!Number.isSafeInteger(policy?.maxSnapshotAgeMs) || policy.maxSnapshotAgeMs < 0)
    throw new TypeError("policy.maxSnapshotAgeMs must be a nonnegative safe integer");
  if (observedAt > now || now - observedAt > policy.maxSnapshotAgeMs)
    throw new Error("Lightning liquidity reading is stale or future-dated");
  const spendable = money(wallet.spendableOutboundMsat, "wallet.spendableOutboundMsat");
  const liquidityHold = money(policy.liquiditySafetyReserveMsat, "policy.liquiditySafetyReserveMsat");
  const other = money(book.otherCommittedMsat, "book.otherCommittedMsat");
  if (!Array.isArray(book.claims)) throw new TypeError("book.claims must be authoritative complete unsettled obligations");
  if (name(sale.walletId, "sale.walletId") !== walletId)
    throw new Error("wrong payout wallet");
  // Native millisatoshi liabilities avoid rounding every microscopic plan
  // up to a whole sat. Conversion to withdrawable sats happens only at
  // the wallet's actual payout boundary.
  const msatUnit = sale.unit === "msat";
  if (sale.unit !== undefined && sale.unit !== "msat" && sale.unit !== "sats")
    throw new TypeError("sale unit must be sats or msat");
  if (msatUnit && (sale.maxRewardSats !== undefined || sale.maxRoutingFeeSats !== undefined))
    throw new TypeError("mixed sat and msat liability claims");
  if (!msatUnit && (sale.maxRewardMsat !== undefined || sale.maxRoutingFeeMsat !== undefined))
    throw new TypeError("msat liability requires explicit msat unit");
  const rewardMsat = msatUnit ? money(sale.maxRewardMsat, "sale.maxRewardMsat") :
    money(sale.maxRewardSats, "sale.maxRewardSats") * 1000n;
  const feeMsat = msatUnit ? money(sale.maxRoutingFeeMsat, "sale.maxRoutingFeeMsat") :
    money(sale.maxRoutingFeeSats, "sale.maxRoutingFeeSats") * 1000n;
  const maximum = rewardMsat + feeMsat;
  if (maximum === 0n) throw new Error("no payable maximum for purported real-reward contract");
  // Reserve the worst-case total for the entire duration, including every
  // possible multiplier, even though most eventual rewards may be smaller.
  const seen = new Set();
  let committed = other;
  let replay = null;
  for (const [i, claim] of book.claims.entries()) {
    const id = name(claim?.intentId, "book.claims[" + i + "].intentId");
    if (seen.has(id)) throw new Error("duplicate claim / booking ID");
    seen.add(id);
    if (name(claim.walletId, "claim.walletId") !== walletId) throw new Error("cross-wallet obligation");
    if (!["reserved", "active", "earned", "payout-in-flight"].includes(claim.state))
      throw new Error("book contains a state not known to preserve liabilities");
    const amount = money(claim.maxRemainingRewardMsat, "claim.maxRemainingRewardMsat");
    const fees = money(claim.maxRemainingFeeMsat, "claim.maxRemainingFeeMsat");
    committed += amount + fees;
    if (id === intentId) replay = {claim, amount: amount + fees};
  }
  if (committed + liquidityHold > spendable)
    return Object.freeze({kind: "PrefundedLightningSaleQuote.v1", state:"suspended-underfunded",
      capacityFits:false, saleReservation:null, walletId, revision, network,
      spendableMsat: spendable.toString(), coveredExistingMsat: committed.toString(),
      safetyReserveMsat:liquidityHold.toString(), availableMsat:"0",
      note:"Existing unsettled obligations and safety reserve already exceed the measured outbound liquidity. Do not sell; reconcile and replenish. Pure quote, not a wallet or ledger reservation."});
  const available = spendable - committed - liquidityHold;
  if (replay) {
    const claim = replay.claim;
    if (claim.actor !== actor || claim.termsRef !== termsRef || replay.amount !== maximum)
      throw new Error("idempotency key reused with a different actor, terms or maximum");
    return Object.freeze({kind:"PrefundedLightningSaleQuote.v1", state:"already-reserved",
      capacityFits:false, saleReservation:null, walletId, revision, network,
      spendableMsat:spendable.toString(), coveredExistingMsat:committed.toString(),
      safetyReserveMsat:liquidityHold.toString(), availableMsat:available.toString(),
      note:"No new obligation. The host must independently verify the original booking and payment status."});
  }
  const accepted = available >= maximum;
  return Object.freeze({
    kind:"PrefundedLightningSaleQuote.v1", state:accepted?"capacity-quoted":"sold-out",
    capacityFits:accepted, saleReservation:accepted?Object.freeze({
      intentId, actor, walletId, termsRef, state:"reserved",
      maxRemainingRewardMsat:rewardMsat.toString(),
      maxRemainingFeeMsat:feeMsat.toString(),
      expectedBookRevision:revision, walletSourceRef:walletSource
    }):null,
    walletId, revision, network, spendableMsat:spendable.toString(),
    coveredExistingMsat:committed.toString(), safetyReserveMsat:liquidityHold.toString(),
    availableMsat:available.toString(),
    additionalWholeOffersAtThisSnapshot:(available/maximum).toString(),
    note:"Nonbinding source-based quote only. Commit the booking atomically using the expected book revision, recheck wallet freshness and available outbound liquidity in the same single-writer admission, then take payment. Never count buyer proceeds or advertiser receivables as backing. No sale, sat credit, or Lightning payment occurred."
  });
}

/** Adapt a signed/trusted Core Lightning listpeerchannels read to an estimate. */
export function projectCoreLightningOutbound({result, walletId, network, observedAt, sourceRef} = {}) {
  if (!result || !Array.isArray(result.channels)) throw new TypeError("Core Lightning listpeerchannels result must contain channels");
  let sum=0n, live=0;
  for (const [i,channel] of result.channels.entries()){
    if (channel.state !== "CHANNELD_NORMAL" || channel.peer_connected !== true) continue;
    let msat=channel.spendable_msat;
    if (typeof msat==="number" && Number.isSafeInteger(msat) && msat>=0) msat=String(msat);
    if (typeof msat!=="string" || !/^(0|[1-9][0-9]*)(?:msat)?$/u.test(msat))
      throw new TypeError("active channel ["+i+"] missing trustworthy spendable_msat");
    const m=BigInt(msat.replace(/msat$/u,""));
    sum+=m;live++;
  }
  if (!["regtest","signet","testnet4","mainnet"].includes(network)) throw new TypeError("unsupported chain network");
  if (!walletId || !sourceRef || !observedAt) throw new TypeError("wallet snapshot custody source missing");
  return Object.freeze({id:walletId,network,observedAt,sourceRef,ready:live>0,spendableOutboundMsat:sum.toString(),
    note:"Sum of Core Lightning active-channel spendable estimates, not guaranteed route liquidity. Wallet source and network must be bound by authenticated node operator, not user JSON."});
}
