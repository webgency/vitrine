import { assignQuadrant, isProvisional, landedPriceUsd, medianScore, toDisplayScore, type Quadrant, type StandingSummary } from "./scoring";
import { DIMENSION_LABELS } from "./rubrics";
import { targetStatus } from "./price-history";
import { dealScore, MIN_INDEPENDENT_SOURCES } from "./valuation";
import { finalists } from "./finalists";
import { dealVerdict } from "./market-copy";
import type { Watch } from "./types";

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
      if (deal.status !== "available") {
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
        todos,
      };
    })
    // Cheapest first: a neutral, stable order that ranks nothing.
    .sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
}
