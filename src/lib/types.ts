// Core domain model for the watch tracker.

export type WatchStatus = "wishlist" | "owned" | "sold";

/**
 * Personal priority, for filtering the collection only. Deliberately coarse:
 * six emotional tiers read as a second verdict beside rubric value, and the
 * next buy shifts as new pieces appear. Never an input to any score.
 */
export type WishlistTier = "shortlist" | "watching" | "pass";

export type MovementType =
  | "automatic"
  | "manual"
  | "quartz"
  | "spring-drive"
  | "solar"
  | "kinetic"
  | "other";

export type Condition = "new" | "pre-owned";

/** Explicit rubric used for price-band scoring. Tags remain descriptive. */
export type ScoringCategory = "diver" | "chronograph" | "gmt" | "dress" | "sports";

export interface Money {
  amount: number;
  /** ISO 4217 currency code, e.g. "USD", "EUR", "GBP". */
  currency: string;
}

export interface RetailerLink {
  url: string;
  retailer?: string;
  price?: Money;
  condition?: Condition;
  /** Date this asking price was observed. Required for market comparisons. */
  observedAt?: string;
  /**
   * This listing's ask moves, oldest first, newest equal to `price`. Moves
   * only, like Watch.priceHistory, so each date means "at this ask since" —
   * unlike observedAt, which advances every time the ask is confirmed. Absent
   * until the ask first changes. Written by `recordAskMove()`.
   */
  askHistory?: PriceSnapshot[];
}

/**
 * One observation of a watch's tracked price. The series includes the current
 * price as its last entry, so `price` and the newest snapshot normally agree.
 *
 * `date` is when the price was first seen at this level, not when it was last
 * confirmed: a run that re-reads an unchanged price extends nothing, so the
 * date answers "it has been this much since when?".
 */
export interface PriceSnapshot {
  price: Money;
  /** ISO timestamp of when this price was first observed. */
  date: string;
  /** Where the observation came from, e.g. "scrape", "manual". */
  source?: string;
}

export interface WatchSpecs {
  caseDiameterMm?: number;
  caseThicknessMm?: number;
  lugToLugMm?: number;
  lugWidthMm?: number;
  caseMaterial?: string;
  movement?: MovementType;
  caliber?: string;
  powerReserveHours?: number;
  waterResistanceM?: number;
  crystal?: string;
  dialColor?: string;
  braceletStrap?: string;
  complications?: string;
}

/**
 * Verifiable finishing/engineering details that feed the caseCraft, bracelet,
 * and movement dimensions. All optional: absence means "not recorded", and the
 * scoring engine treats it as unknown, never as a zero.
 */
export interface QualityFlags {
  /** Number of positions the movement is regulated in. 0 or absent = unregulated. */
  regulatedPositions?: number;
  /** Manufacturer accuracy spec in seconds/day, e.g. 12 for +/-12s/d. */
  accuracySpecSpd?: number;
  /** Surface hardening in Vickers, e.g. 1000. */
  hardenedCoatingHv?: number;
  /** Antimagnetic rating in A/m, e.g. 25000. */
  antimagneticAm?: number;
  sapphireBezelInsert?: boolean;
  /** Ceramic bezel insert (Rolex Cerachrom and the like). Shares the bezel input
   * with sapphireBezelInsert; an aluminium insert records both as false. */
  ceramicBezelInsert?: boolean;
  drilledLugs?: boolean;
  microAdjustClasp?: boolean;
  quickRelease?: boolean;
  braceletIncluded?: boolean;
  /** Anti-reflective coating layer count, when the brand publishes one. */
  arLayers?: number;
  /**
   * Whether an AR coating is present, for the common case where the brand
   * says "anti-reflective coated" and never gives a layer count.
   *
   * The same input as arLayers, recorded more coarsely — not a second one.
   * arLayers wins when both are set, because a count is strictly more
   * information. false is a verified absence, not an absence of evidence:
   * leave the field out when the page simply does not say.
   */
  arCoated?: boolean;
}

/**
 * One completed sale, recorded by hand from a source you actually saw.
 *
 * Every field but `url` and `notes` is required: a sold price with no date,
 * condition or source cannot be judged later, and a half-recorded comp is
 * worse than none. Solds are never scraped and never estimated — and they do
 * not feed the deal score, which stays a comparison of asking prices.
 */
export interface SoldComp {
  price: Money;
  condition: Condition;
  /** ISO date the sale completed. */
  soldAt: string;
  /** Where the sale was seen, e.g. an auction house or forum. */
  source: string;
  url?: string;
  notes?: string;
}

/** How worn a watch is, for a buyer. Definitions live in listing-shape.mjs. */
export type ConditionGrade = "unworn" | "excellent" | "very-good" | "good" | "fair";

/** Where else your own listing is posted. Never a RetailerLink: your own ask
 * is not market evidence, so it must not reach valuation, alerts or history. */
export interface ListingPosting {
  platform: string;
  url?: string;
  askingPrice?: Money;
  /** YYYY-MM-DD. */
  postedAt: string;
}

/** What a listing says, shared by a private draft and a published listing. */
export interface ListingContent {
  askingPrice: Money;
  grade: ConditionGrade;
  conditionNotes?: string;
  /** Box, papers, extra links, straps… */
  included: string[];
  /** Public summary only; receipts and costs stay private. */
  serviceHistory?: string;
  /**
   * Your own photos. Published: paths under public/listings/<id>/. Draft (in
   * data/private.json): data URLs, so nothing reaches git before it goes live.
   */
  photos: string[];
  description?: string;
  postings?: ListingPosting[];
}

/**
 * A published sale listing: a layer on an owned watch, not a status. The
 * watch stays owned — in the collection and in trade-up — until it is marked
 * sold. Drafts are not stored here at all (see private-store.ts).
 *
 * Consignment would add an owner/consignor reference here; nothing reads one
 * yet, so there is no field for it.
 */
export interface SaleListing extends ListingContent {
  state: "live" | "reserved";
  /** ISO timestamp the listing first went live. */
  listedAt: string;
}

export type Availability = "in-stock" | "pre-order" | "sold-out" | "discontinued";

export const AVAILABILITY_STATES: Availability[] = [
  "in-stock",
  "pre-order",
  "sold-out",
  "discontinued",
];

/**
 * Non-spec factors that gate a purchase decision. Rendered as chips and used
 * to caveat verdicts; NEVER folded into any numeric score.
 */
export interface Friction {
  availability: Availability;
  /** ISO date, for pre-orders. */
  expectedShipDate?: string;
  /** Extra cost to get the bracelet instead of the stock strap. */
  braceletUpchargeUsd?: number;
  /** 5 = established secondary market, 1 = effectively unsellable. */
  brandLiquidity: 1 | 2 | 3 | 4 | 5;
}

export interface Watch {
  id: string;
  brand: string;
  model: string;
  referenceNumber?: string;
  status: WatchStatus;
  /** Personal wishlist priority bucket for planning. */
  wishlistTier?: WishlistTier;
  /**
   * One of the few watches you're actually choosing between (at most
   * MAX_FINALISTS). Personal, never scored; set only through the finalist
   * endpoint, which enforces the cap.
   */
  finalist?: boolean;
  /** Rubric category for value scoring; inferred from an unambiguous legacy tag when absent. */
  scoringCategory?: ScoringCategory;
  /** User-rated visual appeal, 1-5. Kept under its original key for data compatibility. */
  designUniqueness?: number;
  /** Pairwise preference rating used only to order watches within the same 1-5 appeal band. */
  designPreferenceElo?: number;
  /** Number of pairwise design choices contributing to designPreferenceElo. */
  designComparisonCount?: number;
  /** Personal, firsthand fit assessment. Kept separate from objective value scoring. */
  personalFit?: number;
  /** Headline price you're tracking (usually the best/target price). */
  price?: Money;
  /** ISO timestamp of when `price` was last refreshed (set by the enrich script). */
  priceUpdatedAt?: string;
  /**
   * Every distinct tracked price seen so far, oldest first. Appended to only
   * when the price actually moves, so consecutive entries always differ.
   */
  priceHistory?: PriceSnapshot[];
  /**
   * "Ping me under $X." Compared against the all-in landed price, so it means
   * the total you are willing to pay, not the sticker.
   */
  targetPrice?: Money;
  /**
   * All-in cost of the configuration actually being considered: base price plus
   * bracelet/strap delta, shipping, and duty. Falls back to `price` when absent.
   */
  landedPrice?: Money;
  qualityFlags?: QualityFlags;
  friction?: Friction;
  links: RetailerLink[];
  /** Completed sales, recorded by hand. Displayed apart from asks; never scored. */
  soldComps?: SoldComp[];
  imageUrl?: string;
  specs: WatchSpecs;
  tags: string[];
  notes?: string;
  /** ISO timestamp set when the watch is first added. */
  dateAdded: string;
  // What you paid is private and lives in data/private.json (see
  // src/lib/private-store.ts), never here: this file is published twice, in
  // the public repo and in the Pages export.
  /** Your published sale listing, when the watch is for sale. */
  listing?: SaleListing;
  /** Filled in when status becomes "sold". Public: the price is real market
   * evidence. Fees, shipping and the buyer stay in data/private.json. */
  sale?: { price?: Money; date?: string; channel?: string };
}

/** Shape accepted when creating a watch (id + dateAdded are assigned by the store). */
export type WatchInput = Omit<Watch, "id" | "dateAdded">;

export const WATCH_STATUSES: WatchStatus[] = ["wishlist", "owned", "sold"];

export const SCORING_CATEGORIES: ScoringCategory[] = ["diver", "chronograph", "gmt", "dress", "sports"];

export const WISHLIST_TIERS: WishlistTier[] = ["shortlist", "watching", "pass"];

export const WISHLIST_TIER_LABELS: Record<WishlistTier, string> = {
  shortlist: "Shortlist",
  watching: "Watching",
  pass: "Pass",
};

export const MOVEMENT_TYPES: MovementType[] = [
  "automatic",
  "manual",
  "quartz",
  "spring-drive",
  "solar",
  "kinetic",
  "other",
];

export const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SGD", "SEK", "NOK", "DKK", "HKD", "NZD"];
