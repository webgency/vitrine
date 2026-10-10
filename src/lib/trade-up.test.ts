import { describe, expect, it } from "vitest";
import { candidateCost, tradeUpBridge, tradeUpModel } from "./trade-up";
import { CURRENCY_TO_USD } from "./currency-rates.mjs";
import type { RetailerLink, Watch } from "./types";

const now = new Date("2026-09-13T12:00:00Z");
const owned: Watch = {
  id: "owned", brand: "Test", model: "Owned", status: "owned",
  price: { amount: 7000, currency: "USD" }, specs: {}, tags: [], links: [], dateAdded: "2026-01-01",
};
const wishlist: Watch = { ...owned, id: "next", status: "wishlist", model: "Next" };
function ask(source: string, amount: number, condition: "pre-owned" | "new" = "pre-owned", observedAt = "2026-09-12"): RetailerLink {
  return { url: `https://${source}.example/watch`, price: { amount, currency: "USD" }, condition, observedAt };
}
const evidence: Watch = { ...owned, links: [ask("a", 800), ask("b", 1000)] };

function exit(watch = evidence) {
  return tradeUpModel(watch, [], now)!.exit;
}

describe("trade-up evidence and candidates", () => {
  it("only appears for owned watches and only lists wishlist candidates", () => {
    expect(tradeUpModel(wishlist, [], now)).toBeUndefined();
    const model = tradeUpModel(owned, [owned, wishlist, { ...owned, id: "sold", status: "sold" }], now)!;
    expect(model.candidates.map((candidate) => candidate.id)).toEqual(["next"]);
  });

  // A purchase price can't reach this model at all now: it lives in the private
  // store, off the Watch type.
  it("never substitutes new asks or tracked prices for pre-owned exit evidence", () => {
    const result = exit({ ...owned, links: [ask("a", 1000, "new"), ask("b", 1200, "new")] });
    expect(result.confidence).toBe("insufficient");
    expect(tradeUpBridge(result, 1500)).toEqual({ status: "insufficient", reason: "exit" });
    expect(result.medianUsd).toBeUndefined();
  });

  it("requires two independent dated sources, even with duplicated listings", () => {
    const result = exit({ ...owned, links: [ask("a", 800), { ...ask("a", 700), url: "https://www.a.example/other" }, { ...ask("b", 900), observedAt: undefined }] });
    expect(result.observations).toHaveLength(1);
    expect(result.medianUsd).toBeUndefined();
  });

  it("retains confidence, oldest freshness and source dates from Market", () => {
    const result = exit({ ...evidence, links: [ask("a", 800), ask("b", 1000, "pre-owned", "2026-01-01")] });
    expect(result).toMatchObject({ confidence: "low", freshness: "expired", medianUsd: 900, lowUsd: 800, highUsd: 1000 });
    expect(result.observations[1].observedAt).toBe("2026-01-01");
  });

  it("uses a dated candidate ask, never its headline price", () => {
    const candidate = tradeUpModel(owned, [{ ...wishlist, links: [ask("c", 1500, "new")] }], now)!.candidates[0];
    expect(candidateCost(candidate, "ask")).toBe(1500);
    const missing = tradeUpModel(owned, [wishlist], now)!.candidates[0];
    expect(candidateCost(missing, "ask")).toBeUndefined();
  });

  it("keeps condition fallback explicit on the candidate", () => {
    const candidate = tradeUpModel(owned, [{ ...wishlist, links: [ask("c", 1500)] }], now)!.candidates[0];
    expect(candidate.best).toMatchObject({ status: "available", conditionMatch: "fallback", preferredCondition: "new" });
  });

  it("offers the target separately and uses the same currency snapshot", () => {
    const candidate = tradeUpModel(owned, [{ ...wishlist, targetPrice: { amount: 1000, currency: "EUR" }, links: [ask("c", 1500, "new")] }], now)!.candidates[0];
    expect(candidateCost(candidate, "ask")).toBe(1500);
    expect(candidateCost(candidate, "target")).toBeCloseTo(1000 * CURRENCY_TO_USD.EUR);
  });

  it("supports a target-only scenario without inventing a listing", () => {
    const candidate = tradeUpModel(owned, [{ ...wishlist, targetPrice: { amount: 1200, currency: "USD" } }], now)!.candidates[0];
    expect(candidate.best.status).toBe("insufficient");
    expect(candidateCost(candidate, "ask")).toBeUndefined();
    expect(candidateCost(candidate, "target")).toBe(1200);
  });

  it("excludes invalid, nonpositive or unconvertible money", () => {
    const invalid = { amount: 500, currency: "UNKNOWN" };
    expect(exit({ ...owned, links: [{ ...ask("a", 1), price: invalid }, ask("b", 0), ask("c", -1)] }).medianUsd).toBeUndefined();
    const candidate = tradeUpModel(owned, [{ ...wishlist, targetPrice: invalid, links: [{ ...ask("a", 1), price: invalid }] }], now)!.candidates[0];
    expect(candidate.target).toBeUndefined();
    expect(candidateCost(candidate, "ask")).toBeUndefined();
  });

  it("does not mutate collection prices, priorities, scores or link order", () => {
    const watches = [evidence, { ...wishlist, wishlistTier: "shortlist" as const, designAppeal: 4 }];
    const before = structuredClone(watches);
    tradeUpModel(evidence, watches, now);
    expect(watches).toEqual(before);
  });
});

describe("trade-up bridge", () => {
  it("subtracts the median and reverses the exit endpoints", () => {
    expect(tradeUpBridge(exit(), 1500)).toEqual({ status: "available", medianUsd: 600, lowUsd: 500, highUsd: 700 });
  });
  it("preserves a negative gap and a range that crosses zero", () => {
    expect(tradeUpBridge(exit(), 850)).toEqual({ status: "available", medianUsd: -50, lowUsd: -150, highUsd: 50 });
  });
  it("supports equality without a false additional amount", () => {
    expect(tradeUpBridge(exit(), 900)).toMatchObject({ status: "available", medianUsd: 0 });
  });
  it("withholds a bridge when candidate evidence is missing", () => {
    expect(tradeUpBridge(exit())).toEqual({ status: "insufficient", reason: "candidate" });
    expect(tradeUpBridge(exit(), NaN)).toEqual({ status: "insufficient", reason: "candidate" });
  });
});
