import { describe, expect, it } from "vitest";

import { normalizeWatchInput, normalizeWatchPatch } from "./validation";

const base = {
  brand: "Test",
  model: "Watch",
  status: "wishlist",
  links: [],
  specs: {},
  tags: [],
};

describe("scoring category validation", () => {
  it("accepts a supported explicit scoring category", () => {
    const result = normalizeWatchInput({ ...base, scoringCategory: "gmt" });
    expect(result).toEqual({ ok: true, data: { ...base, scoringCategory: "gmt" }, warnings: [] });
  });

  it("rejects an unsupported scoring category", () => {
    const result = normalizeWatchInput({ ...base, scoringCategory: "field" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("scoringCategory must be one of diver, chronograph, gmt, dress, sports");
  });

  it("clears an explicit category when a patch sends null", () => {
    expect(normalizeWatchPatch({ scoringCategory: null })).toEqual({
      ok: true,
      data: { scoringCategory: undefined },
      warnings: [],
    });
  });
});

describe("design preference validation", () => {
  it("accepts pairwise rating metadata", () => {
    expect(normalizeWatchPatch({ designPreferenceElo: 1016, designComparisonCount: 3 })).toEqual({
      ok: true,
      data: { designPreferenceElo: 1016, designComparisonCount: 3 },
      warnings: [],
    });
  });

  it("clears pairwise metadata with nulls", () => {
    expect(normalizeWatchPatch({ designPreferenceElo: null, designComparisonCount: null })).toEqual({
      ok: true,
      data: { designPreferenceElo: undefined, designComparisonCount: undefined },
      warnings: [],
    });
  });

  it("rejects negative Elo and fractional comparison counts", () => {
    const result = normalizeWatchPatch({ designPreferenceElo: -1, designComparisonCount: 1.5 });
    expect(result.ok).toBe(false);
  });
});

describe("personal fit validation", () => {
  it("accepts a 1-5 firsthand fit rating", () => {
    expect(normalizeWatchPatch({ personalFit: 5 })).toEqual({ ok: true, data: { personalFit: 5 }, warnings: [] });
  });

  it("rejects ratings outside 1-5", () => {
    expect(normalizeWatchPatch({ personalFit: 6 }).ok).toBe(false);
  });
});

describe("market observation validation", () => {
  it("accepts an observation date on a retailer price", () => {
    const result = normalizeWatchPatch({
      links: [{
        url: "https://example.com/watch",
        price: { amount: 900, currency: "USD" },
        condition: "new",
        observedAt: "2026-09-05",
      }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.links?.[0].observedAt).toBe("2026-09-05");
  });

  it("rejects an invalid observation date", () => {
    const result = normalizeWatchPatch({
      links: [{ url: "https://example.com/watch", observedAt: "not-a-date" }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("finalist through the edit API", () => {
  it("is refused, so the cap can't be bypassed", () => {
    const result = normalizeWatchPatch({ finalist: true });
    expect(result.ok).toBe(false);
  });
});
