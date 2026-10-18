/**
 * Quote ONE sponsored attention unit using explicit, same-denomination USD
 * cashflow assumptions, without promising any reward, moving money or
 * recording a conversion. A house promotion has no external advertising yield.
 *
 * Cash means existing, reconciled, unencumbered liquidity *before* this
 * proposed unit's expenses, reserves, reward and acquisition allocation.
 * Publisher payout means what the advertising partner proposes to pay 561,
 * not its advertiser's gross campaign cost and not collected cash.
 */
const SCALE = 1000000n;
function usdMicros(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/u.test(value))
    throw new TypeError(label + ' requires nonnegative USD decimal string (up to six places)');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0') || '0');
}
function usd(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(6, '0').replace(/0+$/u, '');
  return whole.toString() + (fraction ? '.' + fraction : '');
}
function identity(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024)
    throw new TypeError(label + ' requires a nonempty source identifier');
  return value;
}
/**
 * @param {object} unit
 * @param {'house'|'sponsored'} unit.channel
 * @param {object} unit.offer required for sponsored units; all provenance is caller-claimed
 * @param {object} unit.costs four explicit costs incl chargeback contingency
 * @param {object} unit.policy acquisition and retained margin are *scenario targets*
 * @param {object} unit.funding unencumbered, independently reconciled cash input
 * @param {object} [unit.btcQuote] explicit BTC/USD source quote (no live FX lookup)
 */
export function quoteRewardedAttentionUnit({channel, offer, costs, policy, funding, btcQuote} = {}) {
  if (!['house', 'sponsored'].includes(channel))
    throw new TypeError('channel must be house or sponsored');
  const cash = usdMicros(funding?.unencumberedClearedUsd, 'funding.unencumberedClearedUsd');
  const delivery = usdMicros(costs?.deliveryUsd, 'costs.deliveryUsd');
  const reversal = usdMicros(costs?.reversalReserveUsd, 'costs.reversalReserveUsd');
  const withdrawal = usdMicros(costs?.withdrawalFeeReserveUsd, 'costs.withdrawalFeeReserveUsd');
  const support = usdMicros(costs?.supportComplianceUsd, 'costs.supportComplianceUsd');
  const acquisitionTarget = usdMicros(policy?.acquisitionTargetUsd, 'policy.acquisitionTargetUsd');
  const retainedMargin = usdMicros(policy?.retainedMarginUsd, 'policy.retainedMarginUsd');
  const totalCosts = delivery + reversal + withdrawal + support + retainedMargin;
  let revenue = 0n;
  if (channel === 'sponsored') {
    identity(offer?.provider, 'offer.provider');
    identity(offer?.sourceRef, 'offer.sourceRef');
    if (!['quoted', 'credited', 'settled'].includes(offer?.state))
      throw new TypeError('offer.state must be quoted, credited or settled');
    revenue = usdMicros(offer.publisherPayoutUsd, 'offer.publisherPayoutUsd');
    if (revenue === 0n) throw new TypeError('a sponsored conversion requires a positive publisher payout');
  } else if (offer?.publisherPayoutUsd !== undefined && usdMicros(offer.publisherPayoutUsd, 'offer.publisherPayoutUsd') !== 0n) {
    throw new TypeError('a house promotion cannot be counted as cash advertising revenue');
  }
  // Both revenue and cleared *prefunded* cash must independently cover the
  // same proposed unit. A provider's unpaid receivable cannot alone fund sats.
  const economicallyAvailable = revenue > totalCosts ? revenue - totalCosts : 0n;
  const cashAvailable = cash > totalCosts ? cash - totalCosts : 0n;
  const allocatable = economicallyAvailable < cashAvailable ? economicallyAvailable : cashAvailable;
  const acquisition = allocatable < acquisitionTarget ? allocatable : acquisitionTarget;
  const rewardBudget = allocatable - acquisition;
  let rewardSats = null;
  let quotedRewardUsd = null;
  if (btcQuote !== undefined) {
    identity(btcQuote?.sourceRef, 'btcQuote.sourceRef');
    if (Number.isNaN(Date.parse(btcQuote?.observedAt)) || typeof btcQuote?.observedAt !== 'string')
      throw new TypeError('btcQuote.observedAt must be a date-time string');
    const usdPerBtc = usdMicros(btcQuote.usdPerBtc, 'btcQuote.usdPerBtc');
    if (usdPerBtc === 0n) throw new TypeError('BTC/USD quotation cannot be zero');
    const sats = rewardBudget * 100000000n / usdPerBtc;
    // Return decimal strings: JS Numbers would silently round large values.
    rewardSats = sats.toString();
    quotedRewardUsd = usd(sats * usdPerBtc / 100000000n);
  }
  return Object.freeze({
    kind: 'RewardedAttentionUnitScenario.v1',
    assurance: 'scenario-only-no-conversion-or-cash-receipt-or-reward-reservation',
    channel,
    publisherRevenueUsd: usd(revenue),
    currentCashCeilingUsd: usd(cash),
    disclosedCostAndRetainedMarginUsd: usd(totalCosts),
    prospectiveAcquisitionAllocationUsd: usd(acquisition),
    maximumUserRewardBudgetUsd: usd(rewardBudget),
    ...(rewardSats === null ? {userRewardSats: null, reason: 'btc-usd-quote-required-to-quote-sats'} :
      {userRewardSats: rewardSats, quotedRewardUsd, reason: rewardSats === '0' ? 'below-one-sat-economics-or-unfunded' : 'bounded-scenario-only'}),
    warning: 'No user has earned sats from this quote. Before promising an amount, authorize the advertiser contract, hold concurrent cash reservations atomically and use a fresh actual BTC/fee quote. Acquire users only after actual cash and conservative cohort LTV/CAC qualify spending.',
  });
}
