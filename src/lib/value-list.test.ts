import { describe, expect, it } from "vitest";
import { anyDealEvidence, compareValueRows, effectiveDealControls, matchesValueFilters, ValueFilters, ValueRow } from "./value-list";
import { Watch } from "./types";

function row(id: string, valueScore?: number, discountPct?: number): ValueRow {
  const watch: Watch = {
    id,
    brand: "Test",
    model: id,
    status: "wishlist",
    wishlistTier: "shortlist",
    scoringCategory: "diver",
    designUniqueness: 4,
    price: { amount: 1000, currency: "USD" },
    links: [],
    specs: { caseDiameterMm: 39 },
    tags: [],
    dateAdded: "2026-01-01T00:00:00.000Z",
  };
  return {
    watch,
    category: "diver",
    priceUsd: 1000,
    summary: {
      designScore: 70,
      standing: {
        peerLabel: "divers, $500-1000",
        peerCount: 1,
        dimensions: {},
        unrated: [],
        valueScore,
        evidenceCoverage: 0.6,
        confidence: "medium",
        beats: [],
        trails: [],
        frictions: [],
      },
    },
    deal: discountPct === undefined
      ? {
          status: "insufficient",
          reason: "fewer-than-two-sources",
          askKind: "tracked",
          preferredCondition: "new",
          usedConditionFallback: false,
          confidence: "insufficient",
          observationCount: 0,
          observationAgesDays: [],
          observations: [],
        }
      : {
          status: "available",
          askKind: "tracked",
          askUsd: 1000,
          preferredCondition: "new",
          evidenceCondition: "new",
          usedConditionFallback: false,
          confidence: "medium",
          observationCount: 2,
          observationAgesDays: [1, 2],
          observations: [],
          fairMedianUsd: 1200,
          fairLowUsd: 1100,
          fairHighUsd: 1300,
          discountPct,
          ratioToMedian: 1000 / 1200,
        },
    offer: { status: "insufficient", reason: "no-dated-offers", preferredCondition: "new", undatedOfferCount: 0 },
    targetMet: false,
  };
}

const filters: ValueFilters = {
  status: "wishlist",
  category: "all",
  confidence: "all",
  hasDealEvidence: false,
  wishlistTier: "all",
};

describe("value list ranking", () => {
  it("ranks rubric value descending and leaves unrated rows last", () => {
    const rows = [row("unrated"), row("lower", 0.4), row("higher", 0.8)].sort((a, b) => compareValueRows(a, b, "value"));
    expect(rows.map((item) => item.watch.id)).toEqual(["higher", "lower", "unrated"]);
  });

  it("does not turn insufficient deal evidence into a percentage", () => {
    const rows = [row("insufficient", 0.8), row("deal", 0.4, 12)].sort((a, b) => compareValueRows(a, b, "deal"));
    expect(rows.map((item) => item.watch.id)).toEqual(["deal", "insufficient"]);
    expect(rows[1].deal.status).toBe("insufficient");
    expect("discountPct" in rows[1].deal).toBe(false);
  });

  it("breaks a value tie by the freshest dated offer, never by priority", () => {
    const withOffer = (id: string, freshness?: string, wishlistTier: Watch["wishlistTier"] = "shortlist") => {
      const item = row(id, 0.7);
      item.watch.wishlistTier = wishlistTier;
      if (freshness) item.offer = { status: "available", offer: { freshness } } as unknown as ValueRow["offer"];
      return item;
    };
    const rows = [withOffer("a-none", undefined), withOffer("b-stale", "stale"), withOffer("c-fresh", "fresh", "pass")]
      .sort((a, b) => compareValueRows(a, b, "value"));
    expect(rows.map((item) => item.watch.id)).toEqual(["c-fresh", "b-stale", "a-none"]);
  });

  it("uses wishlist tier only as a filter", () => {
    const mustHave = row("shortlist", 0.4);
    const interested = row("watching", 0.9);
    interested.watch.wishlistTier = "watching";
    expect(matchesValueFilters(mustHave, { ...filters, wishlistTier: "shortlist" })).toBe(true);
    expect(matchesValueFilters(interested, { ...filters, wishlistTier: "shortlist" })).toBe(false);
    expect(compareValueRows(interested, mustHave, "value")).toBeLessThan(0);
  });

  it("filters by evidence, price, design, and category without changing scores", () => {
    const candidate = row("candidate", 0.7, 10);
    expect(matchesValueFilters(candidate, {
      ...filters,
      category: "diver",
      minPrice: 900,
      maxPrice: 1100,
      minDesign: 4,
      confidence: "medium",
      hasDealEvidence: true,
    })).toBe(true);
    expect(candidate.summary.standing.valueScore).toBe(0.7);
  });
});

describe("deal column visibility", () => {
  it("hides deal controls until at least one watch has a deal", () => {
    expect(anyDealEvidence([row("a", 0.6), row("b", 0.5)])).toBe(false);
    expect(anyDealEvidence([row("a", 0.6), row("b", 0.5, 8)])).toBe(true);
  });

  it("falls back from a deal sort or filter restored from a URL when no deal exists", () => {
    expect(effectiveDealControls("deal", true, false)).toEqual({ sort: "value", hasDealEvidence: false });
    expect(effectiveDealControls("price-asc", false, false)).toEqual({ sort: "price-asc", hasDealEvidence: false });
    expect(effectiveDealControls("deal", true, true)).toEqual({ sort: "deal", hasDealEvidence: true });
  });
});
