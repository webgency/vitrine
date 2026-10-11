import { landedPriceUsd, normalizePriceToUsd } from "./scoring";
import { Condition, Money, RetailerLink, Watch } from "./types";
import {
  bestDatedOffer,
  FRESHNESS_MAX_AGE_DAYS as SHARED_FRESHNESS_MAX_AGE_DAYS,
  freshnessForAge as sharedFreshnessForAge,
  freshnessForAges as sharedFreshnessForAges,
  observationAgeDays as sharedObservationAgeDays,
  trackedAskCondition as sharedTrackedAskCondition,
} from "./offer-signals.mjs";

export type FreshnessTier = "fresh" | "aging" | "stale" | "expired";

export const FRESHNESS_MAX_AGE_DAYS: Record<Exclude<FreshnessTier, "expired">, number> = {
  ...SHARED_FRESHNESS_MAX_AGE_DAYS,
};

/** Whole days since an observation, clamped at zero for future-dated records. */
export function observationAgeDays(observedAt: string, now: Date = new Date()): number | undefined {
  return sharedObservationAgeDays(observedAt, now);
}

export function freshnessForAge(ageDays: number): FreshnessTier {
  return sharedFreshnessForAge(ageDays);
}

/** Conservative summary: evidence is only as current as its oldest input. */
export function freshnessForAges(ages: number[]): FreshnessTier | undefined {
  return sharedFreshnessForAges(ages);
}

export type MarketConfidence = "insufficient" | "low" | "medium" | "high";

export interface MarketObservation {
  source: string;
  priceUsd: number;
  observedAt: string;
  ageDays: number;
  freshness: FreshnessTier;
}

export interface MarketValueSummary {
  condition: Condition;
  observations: MarketObservation[];
  confidence: MarketConfidence;
  /** Tier of the oldest observation included in the estimate. */
  freshness?: FreshnessTier;
  medianUsd?: number;
  lowUsd?: number;
  highUsd?: number;
}

interface DealScoreBase {
  /** All-in ask when recorded, otherwise the headline tracked ask. */
  askUsd?: number;
  askKind: "landed" | "tracked";
  preferredCondition: Condition;
  usedConditionFallback: boolean;
  confidence: MarketConfidence;
  observationCount: number;
  observationAgesDays: number[];
  observations: MarketObservation[];
  /** Tier of the oldest observation behind the fair-ask estimate. */
  freshness?: FreshnessTier;
}

export interface AvailableDealScore extends DealScoreBase {
  status: "available";
  askUsd: number;
  /** Condition of the market evidence actually used. */
  evidenceCondition: Condition;
  fairMedianUsd: number;
  fairLowUsd: number;
  fairHighUsd: number;
  /** Positive means the tracked ask is below the fair asking-price median. */
  discountPct: number;
  /** Tracked ask divided by fair median; 1 means exactly at the median. */
  ratioToMedian: number;
}

export interface InsufficientDealScore extends DealScoreBase {
  status: "insufficient";
  evidenceCondition?: Condition;
  reason: "missing-ask" | "fewer-than-two-sources";
  /** Market evidence may exist even when no tracked ask is available. */
  fairMedianUsd?: number;
  fairLowUsd?: number;
  fairHighUsd?: number;
  /** Deliberately absent: thin evidence must never produce a precise deal %. */
  discountPct?: never;
  ratioToMedian?: never;
}

export type DealScore = AvailableDealScore | InsufficientDealScore;

export interface DatedOffer {
  price: Money;
  priceUsd: number;
  url: string;
  source: string;
  condition?: Condition;
  observedAt: string;
  ageDays: number;
  freshness: FreshnessTier;
}

export interface AvailableBestOffer {
  status: "available";
  offer: DatedOffer;
  preferredCondition: Condition;
  conditionMatch: "matched" | "fallback" | "unknown";
  usedConditionFallback: boolean;
  undatedOfferCount: number;
}

export interface InsufficientBestOffer {
  status: "insufficient";
  reason: "no-dated-offers";
  preferredCondition: Condition;
  undatedOfferCount: number;
}

export type BestOffer = AvailableBestOffer | InsufficientBestOffer;

export interface BestOfferTargetStatus {
  target: Money;
  targetUsd: number;
  comparisonUsd: number;
  met: boolean;
  /** Per-offer shipping and duty are not modeled, so this is always listed. */
  basis: "listed";
}

/** Independent dated sources needed before any asking-price estimate exists. */
export const MIN_INDEPENDENT_SOURCES = 2;

export function marketSourceKey(link: RetailerLink): string {
  try {
    return new URL(link.url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return (link.retailer || link.url).trim().toLowerCase();
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Lowest dated retailer ask, preferring the condition of the tracked/deal
 * context. The headline price is never injected here: every candidate comes
 * directly from links[]. If no preferred-condition offer exists, the lowest
 * remaining dated offer is returned with either fallback or unknown condition
 * explicitly recorded. Undated prices are counted but cannot win.
 */
export function bestOffer(
  watch: Watch,
  preferredCondition: Condition = trackedAskCondition(watch),
  now: Date = new Date()
): BestOffer {
  return bestDatedOffer(watch, preferredCondition, now) as BestOffer;
}

/**
 * Compare a best offer with the target without attributing watch-level landed
 * cost to an individual retailer. The schema has no provenance link between
 * landedPrice and links[], so every result is explicitly listed-price-only.
 */
export function bestOfferTargetStatus(
  watch: Watch,
  result: BestOffer = bestOffer(watch)
): BestOfferTargetStatus | undefined {
  if (!watch.targetPrice || result.status !== "available") return undefined;
  const comparisonUsd = result.offer.priceUsd;
  const targetUsd = normalizePriceToUsd(watch.targetPrice);
  return {
    target: watch.targetPrice,
    targetUsd,
    comparisonUsd,
    met: comparisonUsd <= targetUsd,
    basis: "listed",
  };
}

/**
 * Builds an asking-price estimate from dated, condition-matched, independent
 * retailer links. The headline tracked price is intentionally excluded: it is
 * often copied from one of these links and counting it again would manufacture
 * a second source. Two independent observations are the minimum for an
 * estimate; fewer observations report insufficient evidence instead of a
 * precise-looking guess.
 */
export function marketValueSummary(
  watch: Watch,
  condition: Condition,
  now: Date = new Date()
): MarketValueSummary {
  const bySource = new Map<string, MarketObservation>();

  for (const link of watch.links) {
    if (link.condition !== condition || !link.price || !link.observedAt) continue;
    const ageDays = observationAgeDays(link.observedAt, now);
    if (ageDays === undefined) continue;
    const key = marketSourceKey(link);
    const observation: MarketObservation = {
      source: link.retailer?.trim() || key,
      priceUsd: normalizePriceToUsd(link.price),
      observedAt: link.observedAt,
      ageDays,
      freshness: freshnessForAge(ageDays),
    };
    const existing = bySource.get(key);
    if (!existing || new Date(existing.observedAt) < new Date(link.observedAt)) bySource.set(key, observation);
  }

  const observations = [...bySource.values()].sort((a, b) => a.priceUsd - b.priceUsd);
  const freshness = freshnessForAges(observations.map((observation) => observation.ageDays));
  if (observations.length < MIN_INDEPENDENT_SOURCES) return { condition, observations, confidence: "insufficient", freshness };

  const prices = observations.map((observation) => observation.priceUsd);
  const recent90 = observations.filter((observation) => observation.ageDays <= 90).length;
  const allRecent30 = observations.every((observation) => observation.ageDays <= 30);
  const confidence: MarketConfidence =
    observations.length >= 5 && allRecent30
      ? "high"
      : observations.length >= 3 && recent90 / observations.length >= 2 / 3
        ? "medium"
        : "low";

  return {
    condition,
    observations,
    confidence,
    freshness,
    medianUsd: median(prices),
    lowUsd: Math.min(...prices),
    highUsd: Math.max(...prices),
  };
}

function otherCondition(condition: Condition): Condition {
  return condition === "new" ? "pre-owned" : "new";
}

/**
 * Infer the condition of the tracked headline ask from a link carrying that
 * exact price. When provenance is absent, wishlist asks default to new; callers
 * can override this when they know the tracked configuration is pre-owned.
 */
export function trackedAskCondition(watch: Watch): Condition {
  return sharedTrackedAskCondition(watch);
}

/**
 * Compare the all-in/tracked ask with a condition-matched fair asking-price
 * median. The headline price is never an observation: marketValueSummary uses
 * only dated, independent retailer links. If the preferred condition has thin
 * evidence but the other condition has at least two sources, that summary is
 * used and the fallback is explicit. Conditions are never pooled.
 */
export function dealScore(
  watch: Watch,
  preferredCondition: Condition = trackedAskCondition(watch),
  now: Date = new Date()
): DealScore {
  const preferred = marketValueSummary(watch, preferredCondition, now);
  const alternateCondition = otherCondition(preferredCondition);
  const alternate = marketValueSummary(watch, alternateCondition, now);
  const preferredAvailable = preferred.confidence !== "insufficient";
  const alternateAvailable = alternate.confidence !== "insufficient";
  const evidence = preferredAvailable ? preferred : alternateAvailable ? alternate : preferred;
  const usedConditionFallback = !preferredAvailable && alternateAvailable;
  const askUsd = landedPriceUsd(watch);
  const base: DealScoreBase & { evidenceCondition?: Condition } = {
    askUsd,
    askKind: watch.landedPrice ? "landed" : "tracked",
    preferredCondition,
    evidenceCondition: preferredAvailable || alternateAvailable ? evidence.condition : undefined,
    usedConditionFallback,
    confidence: evidence.confidence,
    observationCount: evidence.observations.length,
    observationAgesDays: evidence.observations.map((observation) => observation.ageDays).sort((a, b) => a - b),
    observations: evidence.observations,
    freshness: evidence.freshness,
  };

  if (askUsd === undefined) {
    return {
      ...base,
      status: "insufficient",
      reason: "missing-ask",
      fairMedianUsd: evidence.medianUsd,
      fairLowUsd: evidence.lowUsd,
      fairHighUsd: evidence.highUsd,
    };
  }
  if (evidence.medianUsd === undefined || evidence.lowUsd === undefined || evidence.highUsd === undefined) {
    return { ...base, status: "insufficient", reason: "fewer-than-two-sources" };
  }

  return {
    ...base,
    status: "available",
    askUsd,
    evidenceCondition: evidence.condition,
    fairMedianUsd: evidence.medianUsd,
    fairLowUsd: evidence.lowUsd,
    fairHighUsd: evidence.highUsd,
    discountPct: ((evidence.medianUsd - askUsd) / evidence.medianUsd) * 100,
    ratioToMedian: askUsd / evidence.medianUsd,
  };
}
