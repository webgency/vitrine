import { describe, expect, it } from "vitest";
import { evidenceBreakdown } from "./evidence-coverage";
import { caliberTier, computeStanding } from "./scoring";
import type { Watch } from "./types";

const nomos: Watch = {
  id: "nomos-test", brand: "NOMOS", model: "Club Campus night sky", status: "wishlist",
  dateAdded: "2026-09-13", links: [], tags: [], scoringCategory: "dress",
  price: { amount: 1890, currency: "USD" },
  specs: { caliber: "DUW 4001", movement: "manual", powerReserveHours: 53,
    caseDiameterMm: 36, caseThicknessMm: 8.2, lugToLugMm: 44.3,
    waterResistanceM: 100, crystal: "Sapphire" },
  qualityFlags: { regulatedPositions: 6, braceletIncluded: false },
};

describe("evidence coverage explanations", () => {
  it("recognizes DUW 4001 and reaches three-quarters coverage with sourced evidence", () => {
    expect(caliberTier("NOMOS DUW 4001", "manual")).toBe(0.8);
    expect(caliberTier("DUW 4999", "manual")).toBeUndefined();
    const standing = computeStanding(nomos, [nomos]);
    expect(standing.evidenceCoverage).toBeCloseTo(3 / 4);
    expect(standing.confidence).toBe("medium");
    expect(standing.dimensions.bracelet).toBeUndefined();
    const rows = evidenceBreakdown(nomos);
    expect(rows.find(r => r.dimension === "movement")).toMatchObject({ coverage: 1, missing: [] });
    expect(rows.find(r => r.dimension === "bracelet")).toMatchObject({ applicable: false });
    expect(rows.find(r => r.dimension === "durability")?.missing).toEqual([]);
    const applicable = rows.filter(r => r.applicable);
    expect(applicable.reduce((sum, r) => sum + r.coverage, 0) / applicable.length).toBeCloseTo(standing.evidenceCoverage);
  });

  it("distinguishes unknown flags from verified absence and respects caliber gating", () => {
    const watch: Watch = { ...nomos, specs: { ...nomos.specs, caliber: "Unknown" }, qualityFlags: { arCoated: false } };
    const rows = evidenceBreakdown(watch);
    expect(rows.find(r => r.dimension === "movement")).toMatchObject({ coverage: 0, gated: true, missing: ["Recognized caliber", "Regulation positions"] });
    expect(rows.find(r => r.dimension === "caseCraft")).toMatchObject({ coverage: 0.25, recorded: ["AR coating"] });
    expect(rows.find(r => r.dimension === "bracelet")).toMatchObject({ applicable: true, coverage: 0 });
  });
});
