import { StandingSummary } from "./scoring";
import { ScoringCategory, Watch, WatchStatus, WishlistTier } from "./types";
import { BestOffer, DealScore } from "./valuation";

export type ValueSortKey =
  | "value"
  | "deal"
  | "price-asc"
  | "price-desc"
  | "size"
  | "design"
  | "recent"
  | "name";

export interface ValueRow {
  watch: Watch;
  summary: StandingSummary;
  category?: ScoringCategory;
  priceUsd?: number;
  deal: DealScore;
  offer: BestOffer;
  targetMet: boolean;
}

export interface ValueFilters {
  status: WatchStatus | "all";
  category: ScoringCategory | "all";
  minPrice?: number;
  maxPrice?: number;
  minDesign?: number;
  confidence: ValueRow["summary"]["standing"]["confidence"] | "all";
  hasDealEvidence: boolean;
  wishlistTier: WishlistTier | "all";
}

const optionalDescending = (value?: number | null): number => value ?? -1;

const FRESHNESS_ORDER = ["fresh", "aging", "stale", "expired"];
/** A fresher dated offer sorts first; no dated offer sorts last. */
const offerRank = (row: ValueRow): number =>
  row.offer.status === "available" ? FRESHNESS_ORDER.indexOf(row.offer.offer.freshness) : FRESHNESS_ORDER.length;

/**
 * Sorts missing evidence last. In particular, an unavailable deal never
 * becomes a made-up 0% discount and an unrated value never becomes a zero.
 */
export function compareValueRows(a: ValueRow, b: ValueRow, sort: ValueSortKey): number {
  const name = `${a.watch.brand} ${a.watch.model}`.localeCompare(`${b.watch.brand} ${b.watch.model}`);
  switch (sort) {
    case "deal":
      return (
        optionalDescending(b.deal.status === "available" ? b.deal.discountPct : undefined) -
          optionalDescending(a.deal.status === "available" ? a.deal.discountPct : undefined) || name
      );
    case "price-asc":
      return (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity) || name;
    case "price-desc":
      return (b.priceUsd ?? -Infinity) - (a.priceUsd ?? -Infinity) || name;
    case "size":
      return (a.watch.specs.caseDiameterMm ?? Infinity) - (b.watch.specs.caseDiameterMm ?? Infinity) || name;
    case "design":
      return optionalDescending(b.summary.designScore) - optionalDescending(a.summary.designScore) || name;
    case "recent":
      return b.watch.dateAdded.localeCompare(a.watch.dateAdded) || name;
    case "name":
      return name;
    case "value":
    default:
      // Value for money first, then how well it is evidenced, then the
      // freshest dated offer. Wishlist priority is never a sort key here.
      return (
        optionalDescending(b.summary.standing.valueScore) - optionalDescending(a.summary.standing.valueScore) ||
        b.summary.standing.evidenceCoverage - a.summary.standing.evidenceCoverage ||
        offerRank(a) - offerRank(b) ||
        name
      );
  }
}

export function matchesValueFilters(row: ValueRow, filters: ValueFilters): boolean {
  const { watch, summary } = row;
  if (filters.status !== "all" && watch.status !== filters.status) return false;
  if (filters.category !== "all" && row.category !== filters.category) return false;
  if (filters.minPrice !== undefined && (row.priceUsd === undefined || row.priceUsd < filters.minPrice)) return false;
  if (filters.maxPrice !== undefined && (row.priceUsd === undefined || row.priceUsd > filters.maxPrice)) return false;
  if (filters.minDesign !== undefined && (watch.designUniqueness === undefined || watch.designUniqueness < filters.minDesign)) return false;
  if (filters.confidence !== "all" && summary.standing.confidence !== filters.confidence) return false;
  if (filters.hasDealEvidence && row.deal.status !== "available") return false;
  if (filters.wishlistTier !== "all" && watch.wishlistTier !== filters.wishlistTier) return false;
  return true;
}

/**
 * Whether any watch can show a deal at all. Until two independent dated asks
 * exist for one watch, a Deal column, sort and filter would read
 * "Insufficient" on every row. Decided over every row rather than the filtered
 * ones, so the column doesn't appear and vanish as filters change.
 */
export function anyDealEvidence(rows: Pick<ValueRow, "deal">[]): boolean {
  return rows.some((row) => row.deal.status === "available");
}

/**
 * A deal sort or filter can arrive from a saved session or a shared URL when
 * no watch has a deal. Fall back rather than sorting by a column that isn't
 * shown, or filtering every row away.
 */
export function effectiveDealControls(
  sort: ValueSortKey,
  hasDealEvidence: boolean,
  dealsExist: boolean
): { sort: ValueSortKey; hasDealEvidence: boolean } {
  if (dealsExist) return { sort, hasDealEvidence };
  return { sort: sort === "deal" ? "value" : sort, hasDealEvidence: false };
}
