import { assignQuadrant, isProvisional, landedPriceUsd, medianScore, toDisplayScore, type Quadrant, type StandingSummary } from "./scoring";
import { DIMENSION_LABELS } from "./rubrics";
import { targetStatus } from "./price-history";
import { dealScore, marketSourceKey, MIN_INDEPENDENT_SOURCES } from "./valuation";
import { listingEligibility } from "./listing-entry";
import { finalists } from "./finalists";
import { dealVerdict } from "./market-copy";
import type { Condition, Watch } from "./types";

/** Worded relative to the median, which is all the quadrant knows. */
export const QUADRANT_LABELS: Record<Quadrant, string> = {
  buy: "Value and design above median",
  aspirational: "Design above median, value below",
  sensible: "Value above median, design below",
  skip: "Value and design below median",
};

export interface DecideTodo {
  key: "second-seller" | "target" | "unrated" | "design";
  text: string;
  /** Where the inline editor for this input lives. */
  href: string;
}

/** What adding a second seller needs: the condition the deal compares, and
 * the sites that already count, so the same site isn't added twice. */
export interface SellerEvidence {
  condition: Condition;
  counted: string[];
  needed: number;
}

/**
 * Plain search links for finding another seller. Built only from what the
 * watch records — nothing is fetched, and no dealer URL is guessed. Bulk
 * crawling is out of scope (00-working-agreements).
 */
export function sellerSearchLinks(watch: Pick<Watch, "brand" | "model" | "referenceNumber">): { label: string; href: string }[] {
  const query = [watch.brand, watch.referenceNumber || watch.model].join(" ").trim();
  return [
    { label: "Chrono24", href: `https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(query)}` },
    { label: "Web search", href: `https://www.google.com/search?q=${encodeURIComponent(`${query} price`)}` },
  ];
}

export interface DecideColumn {
  watch: Watch;
  priceUsd?: number;
  /** Positive when the all-in price is above target. */
  targetGapUsd?: number;
  targetMet: boolean;
  value?: number;
  quality?: number;
  design?: number;
  provisional: boolean;
  evidenceCoverage: number;
  frictions: string[];
  quadrant: Quadrant | null;
  deal?: string;
  /** Present until two independent sellers count; the deal needs them. */
  sellers?: SellerEvidence;
  todos: DecideTodo[];
}

/**
 * The finalists side by side. Every figure is one axis as the rest of the app
 * computes it — nothing here is blended into a decision score, because a
 * single number would hide exactly the trade-off being decided. The quadrant
 * places each watch against the collection's medians, the old value matrix's
 * rule, using the wishlist and owned watches as the reference.
 */
export function decideColumns(watches: Watch[], summaries: Record<string, StandingSummary>, now = new Date()): DecideColumn[] {
  const pool = watches.filter((watch) => watch.status !== "sold");
  const valueOf = (watch: Watch) => {
    const score = summaries[watch.id]?.standing.valueScore;
    return score === undefined ? null : toDisplayScore(score);
  };
  const thresholds = {
    value: medianScore(pool.flatMap((watch) => valueOf(watch) ?? [])) ?? 50,
    design: medianScore(pool.flatMap((watch) => summaries[watch.id]?.designScore ?? [])) ?? 50,
  };

  return finalists(watches)
    .map((watch): DecideColumn => {
      const summary = summaries[watch.id];
      const standing = summary.standing;
      const value = valueOf(watch);
      const target = targetStatus(watch);
      const deal = dealScore(watch, undefined, now);
      const todos: DecideTodo[] = [];
      let sellers: SellerEvidence | undefined;
      if (deal.status !== "available") {
        const counted = listingEligibility(watch.links, deal.preferredCondition, now)
          .filter((row) => !row.reasons.length)
          .map((row) => row.link.retailer?.trim() || marketSourceKey(row.link));
        sellers = { condition: deal.preferredCondition, counted, needed: Math.max(0, MIN_INDEPENDENT_SOURCES - counted.length) };
        const sources = Math.min(deal.observationCount, MIN_INDEPENDENT_SOURCES);
        todos.push({
          key: "second-seller",
          text: `Add another seller's price (${sources} of ${MIN_INDEPENDENT_SOURCES})`,
          href: `/watch/${watch.id}#market`,
        });
      }
      if (!watch.targetPrice) todos.push({ key: "target", text: "Set a target", href: `/watch/${watch.id}` });
      if (standing.unrated.length) {
        todos.push({
          key: "unrated",
          text: `Unrated: ${standing.unrated.map((dimension) => DIMENSION_LABELS[dimension]).join(", ")}`,
          href: `/watch/${watch.id}#standing`,
        });
      }
      if (summary.designScore === null) todos.push({ key: "design", text: "Rate the design", href: "/design" });

      return {
        watch,
        priceUsd: landedPriceUsd(watch),
        targetGapUsd: target ? target.gapUsd : undefined,
        targetMet: target?.met ?? false,
        value: value === null ? undefined : Math.round(value),
        quality: standing.qualityScore === undefined ? undefined : Math.round(toDisplayScore(standing.qualityScore)),
        design: summary.designScore === null ? undefined : Math.round(summary.designScore),
        provisional: isProvisional(standing),
        evidenceCoverage: standing.evidenceCoverage,
        frictions: standing.frictions,
        quadrant: assignQuadrant(value, summary.designScore, thresholds),
        deal: deal.status === "available" ? dealVerdict(deal) : undefined,
        sellers,
        todos,
      };
    })
    // Cheapest first: a neutral, stable order that ranks nothing.
    .sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
}
