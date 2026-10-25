// Fixed reference data for the standing engine.
//
// Peer groups in this dataset are small (typically 2-4 watches), so dimensions
// are scored against a fixed price-to-par line (dimensionPar) instead of
// percentiles. Category and price band survive only for the peer label and for
// filtering; percentile ranking is applied only when a group has n >= 6.

export type Dimension =
  | "movement"
  | "caseCraft"
  | "wearability"
  | "durability"
  | "bracelet";

export const DIMENSIONS: Dimension[] = [
  "movement",
  "caseCraft",
  "wearability",
  "durability",
  "bracelet",
];

/** Display names for the scored dimensions. */
export const DIMENSION_LABELS: Record<Dimension, string> = {
  movement: "movement",
  caseCraft: "case features",
  wearability: "case profile",
  durability: "durability",
  bracelet: "bracelet",
};

/** What each dimension actually reads, for tooltips and detail views. */
export const DIMENSION_BLURBS: Record<Dimension, string> = {
  movement: "Caliber tier, plus a chronograph credit, regulation and power reserve.",
  caseCraft: "Recorded case hardware and treatments: hardening, a sapphire or ceramic bezel insert, drilled lugs, and AR layers, scored on what is known. This does not rate visual finishing quality.",
  wearability: "Objective case proportions from diameter, thickness, and—when recorded—lug-to-lug. Personal fit is rated separately.",
  durability: "Water resistance on one scale for every category (full marks at 100m), plus a sapphire crystal.",
  bracelet: "Bracelet hardware: whether one is included, micro-adjust clasp, quick-release.",
};

/** Categories the rubric knows about. Watches whose tags match none stay unrated. */
import { RUBRIC_CATEGORIES as RUBRIC_CATEGORY_LIST } from "./rubric-categories.mjs";
import type { ScoringCategory } from "./types";

export type RubricCategory = ScoringCategory;

// Imported rather than restated so scripts/audit-data.mjs, which runs under
// bare Node, reads the same list the type system checks RUBRICS against.
export const RUBRIC_CATEGORIES: RubricCategory[] = RUBRIC_CATEGORY_LIST as RubricCategory[];

export type PriceBandId =
  | "under-500"
  | "500-1000"
  | "1000-2000"
  | "2000-5000"
  | "5000-plus";

export interface PriceBand {
  id: PriceBandId;
  /** Display label, e.g. "$500-1000". */
  label: string;
  minUsd: number;
  /** Upper edge used for banding. The top band is open-ended for membership. */
  maxUsd: number;
}

export const PRICE_BANDS: PriceBand[] = [
  { id: "under-500", label: "under $500", minUsd: 0, maxUsd: 500 },
  { id: "500-1000", label: "$500-1000", minUsd: 500, maxUsd: 1000 },
  { id: "1000-2000", label: "$1000-2000", minUsd: 1000, maxUsd: 2000 },
  { id: "2000-5000", label: "$2000-5000", minUsd: 2000, maxUsd: 5000 },
  { id: "5000-plus", label: "$5000+", minUsd: 5000, maxUsd: 12000 },
];

/** Band containing a USD price. Prices above the last band's edge stay in the last band. */
export function priceBandFor(usd: number): PriceBand {
  return PRICE_BANDS.find((band) => usd < band.maxUsd) ?? PRICE_BANDS[PRICE_BANDS.length - 1];
}

/**
 * What each category is generally expected to have. Durability no longer reads
 * these: water resistance is scored on one scale for every category, so value
 * can be compared across them (see waterResistanceScore in scoring.ts).
 */
export const CATEGORY_EXPECTATION: Record<
  RubricCategory,
  { wrM: number; needsBezel: boolean; needsScrewCrown: boolean }
> = {
  diver: { wrM: 200, needsBezel: true, needsScrewCrown: true },
  chronograph: { wrM: 50, needsBezel: false, needsScrewCrown: false },
  gmt: { wrM: 100, needsBezel: false, needsScrewCrown: false },
  dress: { wrM: 30, needsBezel: false, needsScrewCrown: false },
  // Field and everyday sports watches: enough to swim in, well short of what a
  // diver is held to. The same 100m bar as gmt, because the requirement is the
  // same one — survive water without being a dive instrument.
  sports: { wrM: 100, needsBezel: false, needsScrewCrown: false },
};

/**
 * Par: the raw score (0-1) each dimension is expected to reach at a price.
 *
 * One line per dimension for every category. Value is meant to be compared
 * across categories — a collection grows by the best specs for the money, not
 * by filling a diver slot and a dress slot — and per-category tables made that
 * impossible. They held a 125-number grid, and the grid set its own verdicts:
 * dress watches cleared a 30m durability bar and averaged 24 points above par
 * on it, while divers, held to 0.70-0.95 by a formula that topped out at 0.75
 * without an antimagnetic rating nobody records, sat 4 points below. Category
 * moved the average value by 8 points before any watch was looked at.
 *
 * Par rises with price on a log scale: a fixed amount every time the price
 * doubles. Across the three dimensions value is built from (VALUE_DIMENSIONS
 * in scoring.ts) the slopes average 0.10, so identical specs at twice the price
 * cost 10 value points: the owner's call on 2026-10-11, measured against 15
 * (value then tracked price at -0.76 and quality at 0.19, so it ranked
 * cheapness) and the old tables' ~7 (value followed quality at 0.75 and price
 * barely at all, -0.12).
 *
 * The slope is split by what money actually buys. Durability gets none: 100m
 * and sapphire are standard by $500, and with a slope its par passed its own
 * 1.0 ceiling near $1900, so every dearer watch would have trailed on it
 * whatever it had. Its anchor fits at 1.00 because the median watch already
 * has both, so durability is a box to tick: it can cost a watch, never lift it.
 * Movement and case profile carry the rise between them.
 * caseCraft and bracelet are display-only and keep roughly the slope the old
 * tables gave them.
 *
 * The anchors are each dimension's median at $1000 across the collection as it
 * stood on 2026-10-11, after removing the price slope, rounded and then frozen.
 * caseCraft and bracelet are fitted on the 13 and 12 watches that record
 * enough of them. They are constants on purpose: par must not move when a
 * watch is added, or a score would change for reasons that have nothing to do
 * with that watch.
 *
 * One deliberate refit, for a change of scale rather than of collection:
 * caseCraft moved from a fixed sum of achieved points to a score over the
 * inputs that are known (2026-10-25), which lifted its raw scores, and the old
 * 0.47 anchor then had 13 of 18 rated watches "above expected". Refit the same
 * way — the median at $1000 of the 18 watches with enough case evidence, slope
 * kept — at 0.64, and frozen again.
 */
export const PAR_ANCHOR_USD = 1000;
export const PAR: Record<Dimension, { atAnchor: number; perDoubling: number }> = {
  movement: { atAnchor: 0.60, perDoubling: 0.15 },
  wearability: { atAnchor: 0.58, perDoubling: 0.15 },
  durability: { atAnchor: 1.00, perDoubling: 0 },
  caseCraft: { atAnchor: 0.64, perDoubling: 0.05 },
  bracelet: { atAnchor: 0.68, perDoubling: 0.08 },
};

/** Expected raw score for a dimension at a USD price. */
export function dimensionPar(dimension: Dimension, priceUsd: number): number {
  return PAR[dimension].atAnchor + PAR[dimension].perDoubling * Math.log2(priceUsd / PAR_ANCHOR_USD);
}
