import { TAG_TO_CATEGORY } from "./categories";
import { isQuartzMovement, normalizeCaliber } from "./calibers";
import { Money, MovementType, QualityFlags, Watch } from "./types";
import {
  CATEGORY_EXPECTATION,
  continuousReference,
  Dimension,
  DIMENSIONS,
  PriceBand,
  priceBandFor,
  RubricCategory,
} from "./rubrics";

export type { Dimension } from "./rubrics";

// ---------------------------------------------------------------------------
// Design score and quadrant placement.
//
// The subjective half of the model: your own read on how a watch looks. The
// standing engine below deliberately has no view on it, so the two are
// combined only at the point of display.
// ---------------------------------------------------------------------------

export type Quadrant = "buy" | "aspirational" | "sensible" | "skip";

export interface ScoreThresholds {
  value: number;
  design: number;
}

/** Bounds of the anchored 1-5 design-appeal rating. */
export const DESIGN_RANK_MIN = 1;
export const DESIGN_RANK_MAX = 5;
export const DESIGN_ELO_BASE = 1000;
export const DESIGN_ELO_K = 32;
/** Ratings 4-5 mean “I like the look”; the line sits between 3 and 4. */
export const DESIGN_LIKE_THRESHOLD = 60;

export type DesignComparisonOutcome = "left" | "right" | "tie";

export function updateDesignElo(
  leftElo = DESIGN_ELO_BASE,
  rightElo = DESIGN_ELO_BASE,
  outcome: DesignComparisonOutcome
): { left: number; right: number } {
  const expectedLeft = 1 / (1 + 10 ** ((rightElo - leftElo) / 400));
  const actualLeft = outcome === "left" ? 1 : outcome === "right" ? 0 : 0.5;
  const change = DESIGN_ELO_K * (actualLeft - expectedLeft);
  return {
    left: Math.round((leftElo + change) * 100) / 100,
    right: Math.round((rightElo - change) * 100) / 100,
  };
}

// Currency conversion rates used before scoring. The table lives in
// ./currency-rates.mjs because scripts/validate-data.mjs needs the same
// currency list and runs under bare Node with no build step. Re-exported here
// so existing importers keep working.
import { CURRENCY_TO_USD as RATES, RATES_AS_OF } from "./currency-rates.mjs";

// Widened to a string index so an unrecognized code reads as undefined and hits
// the warning path below, rather than being a type error at every call site.
export const CURRENCY_TO_USD: Record<string, number> = RATES;
export { RATES_AS_OF };

export function normalizePriceToUsd(money: Money, onWarning?: (message: string) => void): number {
  const currency = money.currency.trim().toUpperCase();
  const rate = CURRENCY_TO_USD[currency];
  if (rate === undefined) {
    onWarning?.(`Unknown currency ${currency}; using a 1.0 USD conversion rate.`);
    return money.amount;
  }
  return money.amount * rate;
}

/**
 * Your anchored 1-5 design appeal as a continuous 0-100 score, or null when
 * you have not rated it. Pairwise preferences refine position only inside the
 * selected 20-point band, so a refined 3 can never outrank a 4.
 *
 * This replaces a weighted desirability score whose three inputs did not hold
 * up. Brand reputation was a constant — every brand in the since-removed
 * data/brands.json sat at reputationTier 3 — so its 35% contributed no
 * variance. Wishlist tier is the
 * judgement the matrix exists to inform, so feeding it back in at 25% made the
 * chart partly restate its own input. Design was the only live term, and for
 * the watches without a design rating the score collapsed to exactly five
 * values, one per wishlist tier.
 *
 * Unranked returns null rather than a neutral 3: a neutral fill would park
 * every unranked watch on the median line and read as an opinion never given.
 */
export function computeDesignScore(watch: Watch): number | null {
  const rank = watch.designUniqueness;
  if (typeof rank !== "number" || !Number.isInteger(rank)) return null;
  if (rank < DESIGN_RANK_MIN || rank > DESIGN_RANK_MAX) return null;
  const bandStart = (rank - DESIGN_RANK_MIN) * 20;
  if (!watch.designComparisonCount || watch.designPreferenceElo === undefined) return bandStart + 10;
  // 80 Elo points spans the useful interior of a band. Clamp away from the
  // edges to preserve a visible gap between adjacent appeal ratings.
  const withinBand = clamp01(0.5 + (watch.designPreferenceElo - DESIGN_ELO_BASE) / 160);
  return bandStart + 1 + withinBand * 18;
}

/** Median of the supplied scores. Callers pass only the watches scored on that axis. */
export function medianScore(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** A watch needs both axes to be placed; either one missing means no quadrant. */
export function assignQuadrant(
  valueScore: number | null,
  designScore: number | null,
  thresholds: ScoreThresholds
): Quadrant | null {
  if (valueScore === null || designScore === null) return null;
  const highValue = valueScore >= thresholds.value;
  const highDesign = designScore >= thresholds.design;
  if (highValue && highDesign) return "buy";
  if (!highValue && highDesign) return "aspirational";
  if (highValue && !highDesign) return "sensible";
  return "skip";
}

// ---------------------------------------------------------------------------
// Peer-band standing engine.
//
// Five dimensions scored 0-1 against the fixed rubrics in ./rubrics.ts.
// A dimension with missing source data is undefined, never a fabricated
// mid value, and is excluded from the composite. Friction flags are surfaced
// as text and never enter any numeric score.
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// Caliber quality tiers, matched as substrings against the normalized caliber
// string so catalog phrasing like "Automatic Cal. Miyota 9075 GMT" still
// resolves. Order matters: more specific patterns first. Extend as watches are
// added. Unknown calibers return undefined — they do NOT fall back to a mid value.
const CALIBER_TIER_PATTERNS: Array<[pattern: string, tier: number]> = [
  ["co-axial master chronometer 8800", 0.95],
  // Rolex 3285. Level with the Omega above rather than ranked against it:
  // both are flagship manufacture calibers and each wins on a different axis
  // (Rolex -2/+2 s/day and a 70h barrel, Omega 15,000 gauss and METAS). The
  // power-reserve bonus in scoreDimensions already separates them on reserve,
  // so baking that into the base tier would count it twice.
  ["3285", 0.95],
  ["mt5450", 0.80],
  ["m100", 0.80],
  // NOMOS DUW 3202. An in-house neomatik automatic running NOMOS's own swing
  // system — an escapement they build rather than buy, which is the rarer
  // thing at any price. Level with the MT5450 above rather than below it: its
  // 42h barrel and its lack of COSC are both already scored elsewhere (the
  // power-reserve bonus, and regulatedPositions), so docking the base tier for
  // either would count them twice — the same reasoning as the Rolex/Omega pair.
  ["duw 3202", 0.80],
  // DUW 4001: manufacture hand-wound caliber with NOMOS swing system and
  // DUW regulation (nomos-glashuette.com/en-us/club/club-campus-night-sky-719).
  // Same architecture tier as DUW 3202; manual winding is not a quality deficit.
  // Reserve and regulation positions are credited separately below.
  ["duw 4001", 0.80],
  // Proprietary automatic monopusher chronograph with a patented retrograde
  // regatta module and 64h reserve; kept below the METAS anchor above.
  ["alb01 a", 0.80],
  // Muehle MU 9419: a Sellita SW500 (the 7750-architecture automatic
  // chronograph) reworked with the woodpecker-neck regulation, a Glashuette
  // three-quarter plate and a 62h barrel. Above the bare SW510 below it for
  // the regulation and the rework, below Tudor's in-house COSC MT5450, which
  // is a movement rather than a treatment of someone else's.
  ["mu 9419", 0.75],
  ["sw510", 0.72],
  ["l688", 0.72],
  ["st-1901b", 0.70],
  // Seagull ST1901: the standard hand-wound column-wheel chronograph Tianjin
  // builds on the Venus 175 tooling bought from Venus in the 1960s — the same
  // architecture as the bespoke ST-1901B above, so it takes the same tier.
  // Kept as its own key rather than aliased onto the B, because the B is one
  // maker's bespoke execution: collapsing them would hide which of the two a
  // watch actually records. The 3 Hz beat and ~38h barrel are scored elsewhere.
  ["st1901", 0.70],
  ["soprod c125", 0.68],
  ["l888", 0.65],
  ["sw300", 0.65],
  // Sellita's GMT caliber, a 2893 derivative — the same architecture family as
  // the 2892-derived SW300, so it sits alongside it. COSC versions are not
  // rated higher here: certification is regulation, which scoreDimensions
  // already rewards separately through regulatedPositions.
  ["sw330", 0.65],
  ["ne88", 0.65],
  ["ne86", 0.62],
  // G100 and its G101 small-seconds sibling use the same 4 Hz, long-reserve
  // platform. Keep both explicit so a future generic LJP string cannot hide
  // whether these known calibers are covered. Reserve is scored separately.
  ["la joux-perret g100", 0.65],
  ["la joux-perret g101", 0.65],
  ["la joux-perret", 0.65],
  ["miyota 9075", 0.62],
  ["powermatic 80", 0.60],
  ["rw3230", 0.60],
  ["peseux 7001", 0.60],
  // Catalogs often wrap Peseux in punctuation ("ETA (Peseux) 7001"), so the
  // caliber number is the stable alias rather than the exact display string.
  ["7001", 0.60],
  ["miyota 9100", 0.58],
  // Miyota 9120: the 9100 without its power-reserve indicator. Same 13 1/2'''
  // base, 26 jewels, 4 Hz, ~40h and -10/+30 s/day (miyotamovement.com lists
  // both), with the same day, month and 24-hour displays. Same tier: like the
  // 8N24 below, a display is not the movement.
  ["miyota 9120", 0.58],
  // Sellita SW461-1: an enlarged SW261-1, which is the small-seconds member of
  // the same 2824-2 architecture family as the SW200 line — so it sits with
  // the SW200-1 of its own generation rather than above it. The 46x number
  // reads like Sellita's chronographs (SW500/SW510) but this is a time, date
  // and small-seconds automatic, not a chronograph. A tighter accuracy spec
  // (REC quotes ±7 s/day) is regulation, which scoreDimensions already credits
  // through accuracySpecSpd, so it must not also lift the base tier.
  ["sw461-1", 0.58],
  ["sw200-1", 0.58],
  ["sw200", 0.55],
  ["miyota 9015", 0.55],
  ["miyota 9039", 0.55],
  ["9039", 0.55],
  ["france ebauche", 0.45],
  // OT.G102 is a 4 Hz automatic base with the maker's jump-hour module. The
  // architecture is distinctive, but it is not presented as chronometer-grade.
  ["ot.g102", 0.45],
  ["st1721", 0.45],
  ["miyota 8215", 0.38],
  // Miyota 8N24 is the open-heart variant of the 8-series base above: the same
  // 21,600 vph architecture and the same non-hacking seconds, with a cut-away
  // dial. Same tier, because the dial is not the movement.
  ["miyota 8n24", 0.38],
  ["nh38", 0.35],
  ["nh34", 0.32],
  ["nh35", 0.30],
  // No quartz rows. normalizeCaliber() never lets a quartz movement reach this
  // table, so a quartz row could only fire on a watch whose movement was
  // missing or mislabelled — scoring the mistake instead of surfacing it.
  // audit:calibers flags that case through QUARTZ_CALIBER_PATTERN.
];

/** Base movement tier for a caliber string, or undefined when unrecognized. */
export function caliberTier(
  caliber: string | undefined,
  movement?: MovementType | string
): number | undefined {
  const key = normalizeCaliber(caliber, movement);
  if (!key) return undefined;
  return CALIBER_TIER_PATTERNS.find(([pattern]) => key.includes(pattern))?.[1];
}

/**
 * Explicit category wins. Legacy tags are accepted only when they resolve to
 * one category; ordering must never decide which rubric a hybrid watch gets.
 */
export function deriveCategory(watch: Watch): RubricCategory | undefined {
  if (watch.scoringCategory) return watch.scoringCategory;

  // The tag vocabulary lives in category-tags.mjs, shared with the bare-Node
  // audit script. It used to be restated here as a chain of comparisons, which
  // is how "sports" came to be a tag the data carried and this function could
  // not see: three watches were tagged and still resolved to nothing.
  const inferred = new Set<RubricCategory>(
    (watch.tags ?? [])
      .map((tag) => TAG_TO_CATEGORY[tag.trim().toLowerCase()])
      .filter((category): category is RubricCategory => category !== undefined)
  );
  return inferred.size === 1 ? [...inferred][0] : undefined;
}

/** All-in USD price used for banding: landedPrice when present, else price. */
export function landedPriceUsd(watch: Watch, onWarning?: (message: string) => void): number | undefined {
  const money = watch.landedPrice ?? watch.price;
  return money ? normalizePriceToUsd(money, onWarning) : undefined;
}

/** qualityFlags each dimension reads. A dimension is rated only if at least one is recorded. */
//
// caseCraft has four inputs, not four flags: AR coating is one input that can
// be recorded two ways, as a layer count when the brand publishes one and as a
// plain yes/no when it only says "anti-reflective coated", which is how most of
// them put it. Treating arCoated as a fifth input would quietly cut every
// existing record's coverage — a watch with 2 of 4 recorded would become 2 of
// 5 and drop under MIN_REFERENCE_COVERAGE without anyone touching its data.
const CASE_CRAFT_INPUTS: Array<(flags: QualityFlags) => boolean> = [
  (f) => f.hardenedCoatingHv !== undefined,
  (f) => f.sapphireBezelInsert !== undefined,
  (f) => f.drilledLugs !== undefined,
  (f) => f.arLayers !== undefined || f.arCoated !== undefined,
];
const BRACELET_FLAGS = ["braceletIncluded", "microAdjustClasp", "quickRelease"] as const;

export interface DimensionEvidence {
  raw: number;
  /** Fraction of this dimension's source inputs that are recorded. */
  coverage: number;
  knownInputs: number;
  totalInputs: number;
}

function evidence(raw: number, knownInputs: number, totalInputs: number): DimensionEvidence {
  return { raw: clamp01(raw), coverage: knownInputs / totalInputs, knownInputs, totalInputs };
}

// Expected case thickness for a diameter: a fixed vertical stack plus a part
// that does scale with width (bezel, crystal dome, lug arch). The pair is
// pinned so that a 40mm case expects 12.4mm — exactly the old 0.31 ratio par —
// which keeps every rubric reference in rubrics.ts calibrated where it was.
// Only the slope away from 40mm changed. The empirical fit over the collection
// (5.53 + 0.173*d) agrees to within 0.06mm at 40mm; these are the rounded pair.
const WEARABILITY_FIXED_STACK_MM = 6.0;
const WEARABILITY_THICKNESS_PER_MM = 0.16;

// Millimetres of thickness between wearing excellently (1) and badly (0),
// held constant across diameters on purpose: 2mm of extra height reads as 2mm
// on the wrist whether the case is 37mm or 44mm wide. Under the old ratio this
// span silently widened with diameter (0.10 * d), which is the second half of
// why big watches got an easier grade than small ones.
const WEARABILITY_SPAN_MM = 4.0;
const EXPECTED_LUG_OVERHANG_MM = 8.0;
const LUG_TO_LUG_SPAN_MM = 8.0;
const THICKNESS_PROFILE_WEIGHT = 0.6;

export function caseProfileEvidence(
  specs: Watch["specs"],
  thicknessAllowanceMm = 0
): DimensionEvidence | undefined {
  if (specs.caseDiameterMm === undefined || specs.caseDiameterMm <= 0 || specs.caseThicknessMm === undefined) {
    return undefined;
  }
  const expectedThicknessMm =
    WEARABILITY_FIXED_STACK_MM + WEARABILITY_THICKNESS_PER_MM * specs.caseDiameterMm + thicknessAllowanceMm;
  const thicknessScore = clamp01(0.5 + (expectedThicknessMm - specs.caseThicknessMm) / WEARABILITY_SPAN_MM);
  const hasLugToLug = specs.lugToLugMm !== undefined;
  const lugToLugScore = hasLugToLug
    ? clamp01(0.5 + (specs.caseDiameterMm + EXPECTED_LUG_OVERHANG_MM - specs.lugToLugMm!) / LUG_TO_LUG_SPAN_MM)
    : undefined;
  const raw = lugToLugScore === undefined
    ? thicknessScore
    : thicknessScore * THICKNESS_PROFILE_WEIGHT + lugToLugScore * (1 - THICKNESS_PROFILE_WEIGHT);
  return evidence(raw, hasLugToLug ? 3 : 2, 3);
}

/**
 * Raw dimension scores against fixed anchors. Any dimension lacking source
 * data returns undefined, not a number:
 * - movement needs a recognized caliber
 * - wearability needs both diameter and thickness
 * - caseCraft and bracelet each need one of their own qualityFlags recorded
 * - durability needs at least one recorded durability input
 */
export function scoreDimensionEvidence(watch: Watch): Partial<Record<Dimension, DimensionEvidence>> {
  const s = watch.specs ?? {};
  const f = watch.qualityFlags ?? {};
  const category = deriveCategory(watch);
  const expectation = category ? CATEGORY_EXPECTATION[category] : undefined;

  const out: Partial<Record<Dimension, DimensionEvidence>> = {};

  const caliberBase = caliberTier(s.caliber, s.movement);
  if (caliberBase !== undefined) {
    // Regulation is expensive and almost nobody at this price point does it.
    const regBonus = f.regulatedPositions ? Math.min(0.2, f.regulatedPositions * 0.05) : 0;
    const prBonus =
      s.powerReserveHours !== undefined ? clamp01((s.powerReserveHours - 38) / 42) * 0.1 : 0;
    const knownInputs = 1 + Number(f.regulatedPositions !== undefined) + Number(s.powerReserveHours !== undefined);
    out.movement = evidence(caliberBase + regBonus + prBonus, knownInputs, 3);
  }

  const profile = caseProfileEvidence(s);
  if (profile) {
    // Thickness measured against what this diameter should cost, not as a bare
    // thickness/diameter ratio. A ratio assumes height scales with width, and
    // it does not: a movement, crystal and caseback are a near-fixed stack
    // whatever the case is around them. Regressing thickness on diameter over
    // the collection gives t = 5.53 + 0.173*d — about 5.5mm that never shrinks.
    // So a ratio charges small cases for height they cannot avoid and hands
    // large ones credit for width they did nothing to earn: a 37x11.6 (a well
    // proportioned watch) scored below a 44x13 (a slab).
    // Thickness remains the primary profile signal, while a compact or broad
    // footprint can move the result meaningfully without claiming to know how
    // the watch fits a particular wrist.
    out.wearability = profile;
  }

  // Each of these needs its own source data. Gating both on "any qualityFlags
  // at all" scored a watch that had only, say, an accuracy spec recorded as
  // though its case had no hardening, no sapphire bezel and no drilled lugs.
  // For caseCraft that fabricated score was the 0.35 base, which sits below
  // every band's rubric reference, so the watch was guaranteed to trail on a
  // dimension nobody had measured.
  if (CASE_CRAFT_INPUTS.some((recorded) => recorded(f))) {
    let achieved = 0;
    if (f.hardenedCoatingHv !== undefined) {
      if (f.hardenedCoatingHv > 0) achieved += 0.2;
    }
    if (f.sapphireBezelInsert !== undefined) {
      if (f.sapphireBezelInsert) achieved += 0.15;
    }
    if (f.drilledLugs !== undefined) {
      if (f.drilledLugs) achieved += 0.1;
    }
    if (f.arLayers !== undefined) {
      achieved += (Math.min(f.arLayers, 8) / 8) * 0.2;
    } else if (f.arCoated) {
      // Credit exactly what "it is coated" guarantees: one layer. A brand that
      // publishes a real count scores higher, which is the right incentive —
      // awarding the average coating here would be inventing a number the
      // manufacturer declined to give.
      achieved += (1 / 8) * 0.2;
    }
    const knownInputs = CASE_CRAFT_INPUTS.filter((recorded) => recorded(f)).length;
    // Keep the established rubric scale: the score states verified capability,
    // while coverage states how much of the possible evidence was inspected.
    // Unknown features add neither verified points nor negative evidence.
    out.caseCraft = evidence(0.35 + achieved, knownInputs, CASE_CRAFT_INPUTS.length);
  }

  // A watch sold on a strap has no bracelet to judge, so the dimension is not
  // applicable rather than bad. Scoring it 0 against a 0.40-0.85 rubric
  // expectation conflated "no bracelet offered" with "poor bracelet", and
  // double-counted a concern the model deliberately keeps out of the numbers:
  // friction.braceletUpchargeUsd already surfaces the cost of adding one, as
  // text. Not applicable is distinct from not recorded, but both mean the
  // dimension should stay out of the composite.
  if (f.braceletIncluded !== false && BRACELET_FLAGS.some((flag) => f[flag] !== undefined)) {
    const parts: Array<[boolean | undefined, number]> = [
      [f.braceletIncluded, 0.4],
      [f.microAdjustClasp, 0.35],
      [f.quickRelease, 0.25],
    ];
    const known = parts.filter(([value]) => value !== undefined);
    const achieved = known.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
    out.bracelet = evidence(achieved, known.length, parts.length);
  }

  if ((s.waterResistanceM !== undefined && expectation) || s.crystal !== undefined || f.antimagneticAm !== undefined) {
    const parts: Array<{ known: boolean; weight: number; score: number }> = [
      {
        known: s.waterResistanceM !== undefined && expectation !== undefined,
        weight: 0.5,
        score: s.waterResistanceM !== undefined && expectation
          ? clamp01(s.waterResistanceM / expectation.wrM)
          : 0,
      },
      {
        known: s.crystal !== undefined,
        weight: 0.25,
        score: (s.crystal ?? "").toLowerCase().includes("sapphire") ? 1 : 0,
      },
      {
        known: f.antimagneticAm !== undefined,
        weight: 0.25,
        score: clamp01((f.antimagneticAm ?? 0) / 25000),
      },
    ];
    const known = parts.filter((part) => part.known);
    const achieved = known.reduce((sum, part) => sum + part.score * part.weight, 0);
    out.durability = evidence(achieved, known.length, parts.length);
  }

  return out;
}

/** Backwards-compatible raw score view for callers that do not need coverage. */
export function scoreDimensions(watch: Watch): Partial<Record<Dimension, number>> {
  return Object.fromEntries(
    Object.entries(scoreDimensionEvidence(watch)).map(([dimension, result]) => [dimension, result.raw])
  );
}

export interface PeerGroup {
  category?: RubricCategory;
  band?: PriceBand;
  /** Display context, e.g. "divers, $500-1000". */
  label: string;
  /** Watches sharing category and band, including the subject watch. */
  members: Watch[];
}

const CATEGORY_PLURAL: Record<RubricCategory, string> = {
  diver: "divers",
  chronograph: "chronographs",
  gmt: "GMTs",
  dress: "dress",
  sports: "sports",
};

/** Peer group = same rubric category + same price band. Unpriced watches group together. */
export function derivePeerGroup(watch: Watch, allWatches: Watch[]): PeerGroup {
  const category = deriveCategory(watch);
  const usd = landedPriceUsd(watch);
  const band = usd !== undefined ? priceBandFor(usd) : undefined;

  const members = allWatches.filter((candidate) => {
    if (deriveCategory(candidate) !== category) return false;
    const candidateUsd = landedPriceUsd(candidate);
    if (band === undefined) return candidateUsd === undefined;
    return candidateUsd !== undefined && priceBandFor(candidateUsd).id === band.id;
  });

  return {
    category,
    band,
    label: `${category ? CATEGORY_PLURAL[category] : "category unrated"}, ${band ? band.label : "unpriced"}`,
    members: members.some((member) => member.id === watch.id) ? members : [...members, watch],
  };
}

/** Percentile within pool (0-1). Use ONLY when pool.length >= 6. */
export function percentile(value: number, pool: number[]): number | undefined {
  if (pool.length < 6) return undefined;
  const below = pool.filter((p) => p < value).length;
  return below / (pool.length - 1);
}

// Rated dimensions must diverge from the rubric reference by more than this
// before a watch is described as above or below expectations for its price.
export const RUBRIC_TOLERANCE = 0.05;

// A single recorded flag can produce a tentative dimension score, but it is
// not enough evidence to make a price-relative verdict or influence value.
// This prevents one narrow fact (for example, a ceramic rather than sapphire
// bezel insert) from masquerading as a judgment of the whole case.
export const MIN_REFERENCE_COVERAGE: Record<Dimension, number> = {
  movement: 1 / 3,
  caseCraft: 0.5,
  wearability: 2 / 3,
  durability: 1 / 3,
  bracelet: 0.5,
};

export interface Standing {
  peerLabel: string;
  peerCount: number;
  /**
   * Per rated dimension: the score, display band, and continuous price
   * reference. `reference` is undefined only when price/category is missing.
   */
  dimensions: Partial<Record<Dimension, { raw: number; coverage: number; knownInputs: number; totalInputs: number; rubricBand: string; reference?: number }>>;
  /** Dimensions with missing source data — display "unrated", never 0. */
  unrated: Dimension[];
  /** Composite of rated dimensions only. Undefined when nothing is rated. */
  qualityScore?: number;
  /** Quality relative to the continuous landed-price expectation. */
  valueScore?: number;
  /** How much applicable source evidence is recorded, from 0-1. */
  evidenceCoverage: number;
  confidence: "low" | "medium" | "high";
  /** Rank of qualityScore within the peer group; only when the group has n >= 6. */
  qualityPercentile?: number;
  /** Dimensions above the continuous price reference. */
  beats: Dimension[];
  /** Dimensions below the continuous price reference. */
  trails: Dimension[];
  /** Human-readable friction chips. Never numeric, never part of any score. */
  frictions: string[];
}

function compositeQuality(raw: Partial<Record<Dimension, DimensionEvidence>>): number | undefined {
  const rated = DIMENSIONS.flatMap((dimension) => {
    const value = raw[dimension];
    return value === undefined ? [] : [value];
  });
  if (rated.length === 0) return undefined;
  const totalWeight = rated.reduce((sum, value) => sum + value.coverage, 0);
  return rated.reduce((sum, value) => sum + value.raw * value.coverage, 0) / totalWeight;
}

export function confidenceFor(coverage: number): Standing["confidence"] {
  if (coverage >= 0.8) return "high";
  if (coverage >= 0.5) return "medium";
  return "low";
}

/**
 * A rubric value resting on low evidence (under half the inputs recorded).
 * With few rated dimensions a score swings further either way, so on
 * 2026-10-11 five of the Value top ten were low-evidence watches. They are
 * grouped apart in rankings rather than adjusted: pulling them toward par
 * would be a fabricated score (invariant 1).
 */
export function isProvisional(standing: Pick<Standing, "valueScore" | "confidence">): boolean {
  return standing.valueScore !== undefined && standing.confidence === "low";
}

function frictionChips(watch: Watch): string[] {
  const friction = watch.friction;
  if (!friction) return [];

  const chips: string[] = [];
  if (friction.availability === "pre-order") {
    chips.push(
      friction.expectedShipDate
        ? `pre-order, ships ${friction.expectedShipDate}`
        : "pre-order"
    );
  } else if (friction.availability === "sold-out") {
    chips.push("sold out");
  } else if (friction.availability === "discontinued") {
    chips.push("discontinued");
  }
  if (friction.braceletUpchargeUsd) {
    chips.push(`bracelet +$${friction.braceletUpchargeUsd}`);
  }
  if (friction.brandLiquidity <= 2) {
    chips.push("thin secondary market");
  }
  return chips;
}

/**
 * Full standing for one watch. Rubric references interpolate continuously from
 * the fixed band-midpoint anchors; the discrete band contributes only the peer
 * label, membership, and (when n >= 6) percentile ranking.
 */
export function computeStanding(watch: Watch, allWatches: Watch[]): Standing {
  const peerGroup = derivePeerGroup(watch, allWatches);
  const raw = scoreDimensionEvidence(watch);
  const usd = landedPriceUsd(watch);
  const band = peerGroup.band;
  const category = peerGroup.category;

  const dimensions: Standing["dimensions"] = {};
  const beats: Dimension[] = [];
  const trails: Dimension[] = [];
  for (const dimension of DIMENSIONS) {
    const value = raw[dimension];
    if (value === undefined) continue;
    const reference = category !== undefined && usd !== undefined
      ? continuousReference(category, dimension, usd)
      : undefined;
    dimensions[dimension] = {
      raw: value.raw,
      coverage: value.coverage,
      knownInputs: value.knownInputs,
      totalInputs: value.totalInputs,
      rubricBand: band?.id ?? "unbanded",
      reference,
    };
    if (reference !== undefined && value.coverage >= MIN_REFERENCE_COVERAGE[dimension]) {
      if (value.raw > reference + RUBRIC_TOLERANCE) beats.push(dimension);
      else if (value.raw < reference - RUBRIC_TOLERANCE) trails.push(dimension);
    }
  }

  const qualityScore = compositeQuality(raw);

  // Par quality at every price scores 0.5: beating the continuously interpolated
  // reference on the rated dimensions raises it. This removes the old boundary
  // cliff without adding a second within-band price adjustment.
  // Price-relative value uses only dimensions with enough evidence to support
  // a comparison. Tentative scores can still inform Quality at reduced weight,
  // but cannot manufacture an above/below expectation verdict.
  let valueScore: number | undefined;
  if (qualityScore !== undefined && category !== undefined && usd !== undefined) {
    const ratedDimensions = DIMENSIONS.filter(
      (dimension) => raw[dimension] !== undefined && raw[dimension]!.coverage >= MIN_REFERENCE_COVERAGE[dimension]
    );
    if (ratedDimensions.length === 0) {
      valueScore = undefined;
    } else {
      const evidenceWeight = ratedDimensions.reduce((sum, dimension) => sum + raw[dimension]!.coverage, 0);
      const comparableQuality =
        ratedDimensions.reduce((sum, dimension) => sum + raw[dimension]!.raw * raw[dimension]!.coverage, 0) /
        evidenceWeight;
      const referenceQuality =
        ratedDimensions.reduce(
          (sum, dimension) => sum + continuousReference(category, dimension, usd) * raw[dimension]!.coverage,
          0
        ) /
        evidenceWeight;
      valueScore = clamp01(0.5 + comparableQuality - referenceQuality);
    }
  }

  // Optional peer-relative rank, only meaningful once the group is big enough.
  let qualityPercentile: number | undefined;
  if (qualityScore !== undefined) {
    const pool = peerGroup.members.flatMap((member) => {
      const memberQuality = compositeQuality(scoreDimensionEvidence(member));
      return memberQuality === undefined ? [] : [memberQuality];
    });
    qualityPercentile = percentile(qualityScore, pool);
  }

  const applicableDimensions = DIMENSIONS.filter(
    (dimension) => dimension !== "bracelet" || watch.qualityFlags?.braceletIncluded !== false
  );
  const evidenceCoverage = applicableDimensions.reduce(
    (sum, dimension) => sum + (raw[dimension]?.coverage ?? 0),
    0
  ) / applicableDimensions.length;

  return {
    peerLabel: peerGroup.label,
    peerCount: peerGroup.members.length,
    dimensions,
    unrated: DIMENSIONS.filter((dimension) => raw[dimension] === undefined),
    qualityScore,
    valueScore,
    evidenceCoverage,
    confidence: confidenceFor(evidenceCoverage),
    qualityPercentile,
    beats,
    trails,
    frictions: frictionChips(watch),
  };
}

export const QUARTZ_UNRATED_REASON = "Quartz movement: not rated on the mechanical tier scale";

/**
 * Why a dimension came back unrated, phrased for display. Keeps the UI honest
 * about which input is missing instead of showing a bare dash. Mirrors the
 * gates in scoreDimensions — if those change, these strings must follow.
 */
export function unratedReason(watch: Watch, dimension: Dimension): string {
  const s = watch.specs ?? {};
  const f = watch.qualityFlags ?? {};
  switch (dimension) {
    case "movement":
      // Checked first, mirroring normalizeCaliber(): a quartz watch is left off
      // the scale on purpose, and "not in the tier table" would read as a gap.
      if (isQuartzMovement(s.movement)) return QUARTZ_UNRATED_REASON;
      return s.caliber ? `Caliber "${s.caliber}" is not in the tier table` : "No caliber recorded";
    case "wearability":
      if (s.caseDiameterMm === undefined && s.caseThicknessMm === undefined)
        return "No case dimensions recorded";
      return s.caseThicknessMm === undefined ? "No case thickness recorded" : "No case diameter recorded";
    case "caseCraft":
      return "No finishing details recorded";
    case "bracelet":
      if (f.braceletIncluded === false) return "Ships on a strap — no bracelet to rate";
      return "No bracelet hardware recorded";
    case "durability":
      return "No water resistance recorded";
  }
}

/**
 * What the UI renders per watch: the objective peer-band standing plus the
 * subjective desire score, which the standing engine deliberately has no view
 * on. Plain data so it can cross the server/client boundary.
 */
export interface StandingSummary {
  standing: Standing;
  /** Your design appeal as 0-100, or null when the watch is unrated. */
  designScore: number | null;
}

/**
 * Par on the 0-1 standing scales. A watch at exactly the rubric reference for
 * its category and band scores 0.5, so the split is an absolute reference and
 * does not move with the contents of the collection.
 */
export const PAR_SCORE = 0.5;

/** Standing scores are 0-1; the UI shows them on the same 0-100 scale as desire. */
export const toDisplayScore = (score: number): number => score * 100;

/**
 * Standings for `watches`, keyed by id. Peer groups are drawn from `pool`, so
 * pass the full collection even when only rendering a subset — a bigger pool
 * means better peer labels and more groups clearing the n >= 6 percentile bar.
 */
export function standingSummaries(watches: Watch[], pool: Watch[]): Record<string, StandingSummary> {
  return Object.fromEntries(
    watches.map((watch) => [
      watch.id,
      { standing: computeStanding(watch, pool), designScore: computeDesignScore(watch) },
    ])
  );
}
