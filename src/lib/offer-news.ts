import { normalizePriceToUsd } from "./scoring";
import type { Money, Watch } from "./types";
import type { BestOffer, BestOfferTargetStatus } from "./valuation";

/**
 * Rate drift tolerated between a tracked price and a link in another currency.
 * A tracked USD figure converted from £2,525 on the day it was saved reads
 * $3,324, while today's saved rates make the same link $3,407: that 2.5% is the
 * exchange rate moving, not the seller. Real mismatches are far larger — a
 * CA$485 tracked price against a US$485 link is 39%.
 */
export const FX_DRIFT_TOLERANCE = 0.03;

function priceDiffers(tracked: Money | undefined, offer: Money, offerUsd: number): boolean {
  if (!tracked) return true;
  if (tracked.currency === offer.currency) return Math.abs(tracked.amount - offer.amount) >= 1;
  const trackedUsd = normalizePriceToUsd(tracked);
  return Math.abs(offerUsd - trackedUsd) / trackedUsd > FX_DRIFT_TOLERANCE;
}

export type OfferNewsReason = "price-differs" | "not-fresh" | "condition" | "at-target";

/**
 * Whether a card's best-offer row tells the reader anything the headline price
 * doesn't. Every watch carries one link, and that link is usually where the
 * tracked price came from, so an always-on row restated the price, a "Fresh"
 * badge and a "New" condition on nearly every card — noise that buried the
 * rows that did differ. Returns the reasons the row earns its place; an empty
 * list means omit it. Omitting is display only: the offer still feeds Market,
 * Value and alerts unchanged.
 */
export function offerNews(
  watch: Pick<Watch, "price" | "targetPrice">,
  offer: BestOffer,
  offerTarget?: BestOfferTargetStatus,
  trackedTargetMet = false
): OfferNewsReason[] {
  if (offer.status !== "available") return [];
  const reasons: OfferNewsReason[] = [];

  if (priceDiffers(watch.price, offer.offer.price, offer.offer.priceUsd)) reasons.push("price-differs");
  if (offer.offer.freshness !== "fresh") reasons.push("not-fresh");
  if (offer.offer.condition !== "new" || offer.conditionMatch !== "matched") reasons.push("condition");
  // The card already says "at target" beside the price; only an offer that
  // meets the target when the tracked price doesn't is news.
  if (offerTarget?.met && !trackedTargetMet) reasons.push("at-target");
  return reasons;
}
