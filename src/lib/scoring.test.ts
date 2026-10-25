import { describe, expect, it } from "vitest";

import {
  assignQuadrant,
  caliberTier,
  computeDesignScore,
  computeStanding,
  medianScore,
  deriveCategory,
  derivePeerGroup,
  percentile,
  QUARTZ_UNRATED_REASON,
  scoreDimensions,
  scoreDimensionEvidence,
  confidenceFor,
  CURRENCY_TO_USD,
  landedPriceUsd,
  normalizePriceToUsd,
  unratedReason,
  updateDesignElo,
  waterResistanceScore,
  isSapphireCrystal,
  isChronographCaliber,
  CHRONOGRAPH_CREDIT,
  VALUE_DIMENSIONS,
  valueFromEvidence,
  accuracyCredit,
  dimensionVerdict,
  CHRONOGRAPH_THICKNESS_ALLOWANCE_MM,
  caseProfileEvidence,
} from "./scoring";
import { CANONICAL_CALIBERS, isQuartzCaliber, isQuartzMovement, QUARTZ_MOVEMENTS } from "./calibers";
import { DIMENSIONS, dimensionPar, PAR } from "./rubrics";
import { CURRENCIES } from "./types";
import {
  RATES_AS_OF,
  RATES_STALE_AFTER_DAYS,
  ratesAgeDays,
  ratesAreStale,
} from "./currency-rates.mjs";
import type { Watch } from "./types";

let nextId = 0;

function makeWatch(overrides: Partial<Watch> = {}): Watch {
  nextId += 1;
  return {
    id: `test-${nextId}`,
    brand: "Testbrand",
    model: "Model",
    status: "wishlist",
    links: [],
    specs: {},
    tags: [],
    dateAdded: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("scoreDimensions", () => {
  it("returns no dimensions for a watch with missing specs", () => {
    const watch = makeWatch();
    expect(scoreDimensions(watch)).toEqual({});
  });

  it("leaves movement undefined for an unknown caliber instead of defaulting to a mid value", () => {
    const watch = makeWatch({
      specs: {
        caliber: "Frankenwerk FW-9000",
        caseDiameterMm: 40,
        caseThicknessMm: 12,
        waterResistanceM: 200,
        crystal: "Sapphire",
      },
      tags: ["diver"],
    });
    const raw = scoreDimensions(watch);
    expect(raw.movement).toBeUndefined();
    expect(caliberTier("Frankenwerk FW-9000")).toBeUndefined();
    // Other dimensions still score from their own data.
    expect(raw.wearability).toBeDefined();
    expect(raw.durability).toBeDefined();
  });

  it("recognizes calibers inside catalog phrasing", () => {
    expect(caliberTier("Automatic Cal. Miyota 9075 GMT")).toBe(0.62);
    expect(caliberTier("Seiko NH35")).toBe(0.3);
    expect(caliberTier(undefined)).toBeUndefined();
  });

  it("leaves a recorded quartz caliber outside the mechanical tier scale", () => {
    expect(caliberTier("Ronda 1032", "quartz")).toBeUndefined();
    expect(scoreDimensions(makeWatch({ specs: { movement: "quartz", caliber: "Ronda 1032" } })).movement)
      .toBeUndefined();
  });

  it("keeps unratedReason's quartz copy in step with the quartz gate", () => {
    // unratedReason mirrors normalizeCaliber's quartz gate. Every movement the
    // gate excludes must get the quartz copy, and only those — the old message
    // told a deliberately unrated VK63 it was missing from the tier table.
    const movements = [...QUARTZ_MOVEMENTS, "automatic", "manual", "spring-drive", "other", undefined];
    for (const movement of movements) {
      const watch = makeWatch({ specs: { movement: movement as Watch["specs"]["movement"], caliber: "Seiko VK63" } });
      const quartz = isQuartzMovement(movement);
      if (quartz) expect(scoreDimensions(watch).movement).toBeUndefined();
      expect(unratedReason(watch, "movement") === QUARTZ_UNRATED_REASON).toBe(quartz);
    }
    expect(unratedReason(makeWatch({ specs: { movement: "quartz" } }), "movement")).toBe(QUARTZ_UNRATED_REASON);
    expect(unratedReason(makeWatch({ specs: { movement: "automatic", caliber: "Acme 1" } }), "movement"))
      .toBe('Caliber "Acme 1" is not in the tier table');
  });

  it("never tiers a quartz caliber, even when the movement is mislabelled", () => {
    // A quartz row could only fire when `movement` is missing or wrong, which
    // would score the data error (meca-quartz used to land level with an NH35).
    for (const caliber of ["Meca-quartz Seiko Japan cal. VK63", "Seiko VK64", "hybrid VK68", "Ronda 1032", "FC-206"]) {
      expect(isQuartzCaliber(caliber)).toBe(true);
      expect(caliberTier(caliber)).toBeUndefined();
      expect(caliberTier(caliber, "automatic")).toBeUndefined();
    }
    expect(CANONICAL_CALIBERS.filter((key) => isQuartzCaliber(key))).toEqual([]);
  });

  it("recognizes every caliber family currently represented in the collection", () => {
    const currentAliases = [
      "ETA (Peseux) 7001, elaboré grade",
      "Seiko/TMI NE86",
      "ALB01 A",
      "Seagull ST1721",
      "OT.G102",
      "Seiko Instruments (SII/TMI) NE88",
      "Miyota 9100",
      "Miyota 8215",
    ];
    expect(currentAliases.filter((caliber) => caliberTier(caliber) === undefined)).toEqual([]);
  });

  it("matches a base caliber through a brand's own designation", () => {
    // Brands rename the movements they buy, so the tier has to survive the
    // house name wrapped around the base caliber.
    expect(caliberTier("Laventure Caliber 3 (Sellita SW330-2)")).toBe(0.65);
    expect(caliberTier("Sellita SW330-2")).toBe(0.65);
    // SW330 must not be picked up by the SW300 pattern, or vice versa.
    expect(caliberTier("Sellita SW300-1")).toBe(0.65);
  });

  it("propagates a missing thickness as no wearability score, not a bad one", () => {
    const watch = makeWatch({ specs: { caseDiameterMm: 40 } });
    expect(scoreDimensions(watch).wearability).toBeUndefined();
  });

  it("keeps the 40mm wearability anchor where the old thickness/diameter ratio put it", () => {
    // Every rubric reference was tuned against a formula where 40x12.4 was par.
    // Moving that anchor would silently recalibrate all four category tables.
    const wearability = (d: number, t: number) =>
      scoreDimensions(makeWatch({ specs: { caseDiameterMm: d, caseThicknessMm: t } })).wearability;
    expect(wearability(40, 12.4)).toBeCloseTo(0.5, 5);
    expect(wearability(40, 10.4)).toBeCloseTo(1, 5);
    expect(wearability(40, 14.4)).toBeCloseTo(0, 5);
  });

  it("does not bottom out a small case for height it cannot avoid", () => {
    // A movement, crystal and caseback are a near-fixed stack, so a bare
    // thickness/diameter ratio charges narrow cases for millimetres that do not
    // scale down. A 37x11.6 is a well proportioned watch and must beat a 44x13
    // slab; under the ratio it scored 0.46 against that slab's 0.65.
    const wearability = (d: number, t: number) =>
      scoreDimensions(makeWatch({ specs: { caseDiameterMm: d, caseThicknessMm: t } })).wearability!;
    expect(wearability(37, 11.6)).toBeGreaterThan(wearability(44, 13));
    // Genuinely thick still reads as thick — this fixes the slope, not the floor.
    expect(wearability(37, 13.8)).toBeLessThan(0.1);
    expect(wearability(41, 16)).toBe(0);
  });

  it("recognizes a compact lug-to-lug as part of case profile", () => {
    const compact = scoreDimensions(makeWatch({
      specs: { caseDiameterMm: 38.5, caseThicknessMm: 12.9, lugToLugMm: 44.5 },
    })).wearability!;
    const thicknessOnly = scoreDimensions(makeWatch({
      specs: { caseDiameterMm: 38.5, caseThicknessMm: 12.9 },
    })).wearability!;
    expect(compact).toBeCloseTo(0.489, 3);
    expect(compact).toBeGreaterThan(thicknessOnly);
  });

  it("scores caseCraft and bracelet only once their own qualityFlags exist", () => {
    const bare = makeWatch();
    expect(scoreDimensions(bare).caseCraft).toBeUndefined();
    expect(scoreDimensions(bare).bracelet).toBeUndefined();

    const flagged = makeWatch({
      qualityFlags: { braceletIncluded: true, microAdjustClasp: true, quickRelease: true },
    });
    const raw = scoreDimensions(flagged);
    expect(raw.bracelet).toBe(1);
    // Bracelet hardware says nothing about case finishing, so caseCraft stays
    // unrated rather than dropping to its 0.35 base.
    expect(raw.caseCraft).toBeUndefined();
  });

  it("leaves caseCraft unrated when only unrelated flags are recorded", () => {
    const watch = makeWatch({ qualityFlags: { accuracySpecSpd: 40 } });
    expect(scoreDimensions(watch).caseCraft).toBeUndefined();
    expect(scoreDimensions(watch).bracelet).toBeUndefined();
  });

  it("rates caseCraft from any one of its own flags, and bracelet independently", () => {
    const watch = makeWatch({ qualityFlags: { drilledLugs: true } });
    const raw = scoreDimensions(watch);
    expect(raw.caseCraft).toBeCloseTo(0.45);
    expect(raw.bracelet).toBeUndefined();
  });

  it("leaves bracelet unrated for a watch sold on a strap", () => {
    const watch = makeWatch({ qualityFlags: { braceletIncluded: false } });
    expect(scoreDimensions(watch).bracelet).toBeUndefined();
  });

  it("still rates bracelet when one is included", () => {
    const watch = makeWatch({ qualityFlags: { braceletIncluded: true, quickRelease: true } });
    expect(scoreDimensions(watch).bracelet).toBeCloseTo(0.65);
  });

  it("tracks missing sub-inputs as lower evidence rather than recorded failures", () => {
    const partial = makeWatch({ qualityFlags: { drilledLugs: true } });
    const moreCertain = makeWatch({ qualityFlags: { drilledLugs: true, sapphireBezelInsert: false } });
    const partialEvidence = scoreDimensionEvidence(partial).caseCraft!;
    const certainEvidence = scoreDimensionEvidence(moreCertain).caseCraft!;

    // Recording an absent feature does not retroactively lower the verified
    // capability score, but it does make the evidence more complete.
    expect(certainEvidence.raw).toBe(partialEvidence.raw);
    expect(partialEvidence.coverage).toBe(0.25);
    expect(certainEvidence.coverage).toBe(0.5);
  });

  it("reports durability coverage separately from its verified score", () => {
    const watch = makeWatch({
      scoringCategory: "diver",
      specs: { waterResistanceM: 200, crystal: "Sapphire" },
    });
    const durability = scoreDimensionEvidence(watch).durability!;
    expect(durability.raw).toBe(1);
    expect(durability.knownInputs).toBe(2);
    expect(durability.totalInputs).toBe(2);
    expect(durability.coverage).toBe(1);

    const wrOnly = scoreDimensionEvidence(makeWatch({ specs: { waterResistanceM: 200 } })).durability!;
    expect(wrOnly.raw).toBe(0.75);
    expect(wrOnly.coverage).toBe(0.5);
  });

  it("excludes an unrated bracelet from the composite rather than scoring it 0", () => {
    const strap = makeWatch({
      specs: { caliber: "NH35", waterResistanceM: 200, crystal: "Sapphire" },
      qualityFlags: { braceletIncluded: false, drilledLugs: true },
      tags: ["diver"],
      price: { amount: 400, currency: "USD" },
    });
    const standing = computeStanding(strap, [strap]);
    expect(standing.unrated).toContain("bracelet");
    expect(standing.dimensions.bracelet).toBeUndefined();
  });

  it("scores water resistance on one scale for every category", () => {
    const dress = makeWatch({ specs: { waterResistanceM: 50, crystal: "Sapphire" }, tags: ["dress"] });
    const diver = makeWatch({ specs: { waterResistanceM: 50, crystal: "Sapphire" }, tags: ["diver"] });
    expect(scoreDimensions(dress).durability).toBe(scoreDimensions(diver).durability);
  });

  it("gives full water-resistance marks at 100m and nothing at 30m", () => {
    expect(waterResistanceScore(30)).toBe(0);
    expect(waterResistanceScore(50)).toBeCloseTo(0.42, 2);
    expect(waterResistanceScore(100)).toBe(1);
    expect(waterResistanceScore(300)).toBe(1);
  });

  it("does not take a sapphire-coated mineral crystal for sapphire", () => {
    expect(isSapphireCrystal("Double-domed sapphire, internal AR coating")).toBe(true);
    expect(isSapphireCrystal("Sapphire-coated mineral crystal (domed)")).toBe(false);
    expect(isSapphireCrystal("K1 mineral Crystal")).toBe(false);
  });

  it("credits a chronograph caliber, read from the caliber rather than the category", () => {
    const chrono = makeWatch({ specs: { caliber: "Sellita SW510 BH M", movement: "manual" }, scoringCategory: "gmt" });
    expect(isChronographCaliber("Sellita SW510 BH M", "manual")).toBe(true);
    expect(isChronographCaliber("Miyota 9075", "automatic")).toBe(false);
    expect(scoreDimensions(chrono).movement).toBeCloseTo(caliberTier("SW510")! + CHRONOGRAPH_CREDIT);
  });

  it("never credits a meca-quartz chronograph, even one recorded as mechanical", () => {
    // Two guards hold this: quartz never reaches the tier table, and no VK
    // caliber is on the chronograph list. The mislabelled rows check the first
    // does not lean on the movement field, which scraped records get wrong.
    for (const [caliber, movement] of [
      ["Seiko VK64", "quartz"],
      ["Seiko VK64", "automatic"],
      ["Seiko VK64", undefined],
      ["TMI VK64 Meca-Quartz", "automatic"],
      ["Meca-quartz Seiko VK63", "manual"],
    ] as const) {
      const watch = makeWatch({ specs: { caliber, movement }, scoringCategory: "chronograph" });
      expect(isChronographCaliber(caliber, movement)).toBe(false);
      expect(scoreDimensions(watch).movement).toBeUndefined();
    }
  });
});

describe("category and peer group derivation", () => {
  it("leaves an unclassified watch without a rubric instead of silently using dress", () => {
    const watch = makeWatch({
      price: { amount: 700, currency: "USD" },
      specs: { caliber: "Seiko NH35", caseDiameterMm: 40, caseThicknessMm: 12 },
    });
    expect(deriveCategory(watch)).toBeUndefined();

    const standing = computeStanding(watch, [watch]);
    expect(standing.peerLabel).toBe("category unrated, $500-1000");
    expect(standing.qualityScore).toBeDefined();
    expect(standing.valueScore).toBeUndefined();
    expect(standing.unrated).toContain("durability");
  });

  it("maps recognized tags case-insensitively and groups by price band", () => {
    const gmt = makeWatch({ tags: ["GMT"], price: { amount: 900, currency: "USD" } });
    const sameBand = makeWatch({ tags: ["worldtimer"], price: { amount: 600, currency: "USD" } });
    const otherBand = makeWatch({ tags: ["GMT"], price: { amount: 2500, currency: "USD" } });
    const otherCategory = makeWatch({ tags: ["diver"], price: { amount: 900, currency: "USD" } });

    const group = derivePeerGroup(gmt, [gmt, sameBand, otherBand, otherCategory]);
    expect(group.label).toBe("GMTs, $500-1000");
    expect(group.members.map((member) => member.id)).toEqual([gmt.id, sameBand.id]);
  });

  it("requires an explicit category when legacy tags name different rubrics", () => {
    const hybrid = makeWatch({ tags: ["GMT", "diver"] });
    expect(deriveCategory(hybrid)).toBeUndefined();
    expect(deriveCategory({ ...hybrid, scoringCategory: "gmt" })).toBe("gmt");
  });

  it("accepts the legacy dive tag without treating every unknown tag as dress", () => {
    expect(deriveCategory(makeWatch({ tags: ["dive"] }))).toBe("diver");
    // "field" now resolves to sports, which is a scored category. A tag that
    // names nothing still resolves to nothing — never to a default.
    expect(deriveCategory(makeWatch({ tags: ["field"] }))).toBe("sports");
    expect(deriveCategory(makeWatch({ tags: ["titanium"] }))).toBeUndefined();
  });

  it("prefers landedPrice over list price for banding", () => {
    const watch = makeWatch({
      tags: ["diver"],
      price: { amount: 950, currency: "USD" },
      landedPrice: { amount: 1150, currency: "USD" },
    });
    expect(derivePeerGroup(watch, [watch]).band?.id).toBe("1000-2000");
  });
});

describe("computeStanding", () => {
  it("handles a peer group of size 1 without a percentile", () => {
    const watch = makeWatch({
      tags: ["diver"],
      price: { amount: 800, currency: "USD" },
      specs: {
        caliber: "Seiko NH35",
        caseDiameterMm: 40,
        caseThicknessMm: 12,
        waterResistanceM: 200,
        crystal: "Sapphire",
      },
    });
    const standing = computeStanding(watch, [watch]);
    expect(standing.peerCount).toBe(1);
    expect(standing.qualityPercentile).toBeUndefined();
    expect(standing.qualityScore).toBeDefined();
    expect(standing.valueScore).toBeDefined();
  });

  it("marks all five dimensions unrated for an empty watch and fabricates no numbers", () => {
    const watch = makeWatch({ price: { amount: 300, currency: "USD" } });
    const standing = computeStanding(watch, [watch]);
    expect(standing.unrated).toEqual(DIMENSIONS);
    expect(standing.dimensions).toEqual({});
    expect(standing.qualityScore).toBeUndefined();
    expect(standing.valueScore).toBeUndefined();
    expect(standing.beats).toEqual([]);
    expect(standing.trails).toEqual([]);
  });

  it("excludes an unrated movement from the composite instead of scoring it 0.5", () => {
    const specs = {
      caseDiameterMm: 40,
      caseThicknessMm: 10,
      waterResistanceM: 200,
      crystal: "Sapphire",
    };
    const unknownCaliber = makeWatch({
      tags: ["diver"],
      price: { amount: 800, currency: "USD" },
      specs: { ...specs, caliber: "Mystery 1" },
    });
    const noCaliber = makeWatch({
      tags: ["diver"],
      price: { amount: 800, currency: "USD" },
      specs,
    });

    const a = computeStanding(unknownCaliber, [unknownCaliber]);
    const b = computeStanding(noCaliber, [noCaliber]);
    expect(a.unrated).toContain("movement");
    // Composite over the same rated dimensions -> identical score.
    expect(a.qualityScore).toBe(b.qualityScore);
  });

  it("never folds friction into any numeric score", () => {
    const base = {
      tags: ["diver"],
      price: { amount: 800, currency: "USD" },
      specs: {
        caliber: "Seiko NH35",
        caseDiameterMm: 40,
        caseThicknessMm: 12,
        waterResistanceM: 200,
        crystal: "Sapphire",
      },
    };
    const clean = makeWatch(base);
    const troubled = makeWatch({
      ...base,
      friction: {
        availability: "pre-order",
        expectedShipDate: "2026-11-01",
        braceletUpchargeUsd: 189,
        brandLiquidity: 1,
      },
    });

    const cleanStanding = computeStanding(clean, [clean]);
    const troubledStanding = computeStanding(troubled, [troubled]);
    expect(troubledStanding.qualityScore).toBe(cleanStanding.qualityScore);
    expect(troubledStanding.valueScore).toBe(cleanStanding.valueScore);
    expect(cleanStanding.frictions).toEqual([]);
    expect(troubledStanding.frictions).toEqual([
      "pre-order, ships 2026-11-01",
      "bracelet +$189",
      "thin secondary market",
    ]);
  });

  it("reports beats and trails against the continuous price rubric", () => {
    const watch = makeWatch({
      tags: ["diver"],
      price: { amount: 800, currency: "USD" },
      specs: { caliber: "Sellita SW510-M", waterResistanceM: 100, crystal: "mineral" },
    });
    const standing = computeStanding(watch, [watch]);
    expect(standing.beats).toContain("movement");
    expect(standing.trails).toContain("durability");
  });

  it("keeps production references and value continuous across a display-band edge", () => {
    const at = (amount: number) => makeWatch({
      scoringCategory: "diver",
      price: { amount, currency: "USD" },
      specs: {
        caliber: "Miyota 9015",
        powerReserveHours: 42,
        caseDiameterMm: 39,
        caseThicknessMm: 12,
        waterResistanceM: 200,
        crystal: "Sapphire",
      },
    });
    const below = at(999);
    const above = at(1001);
    const belowStanding = computeStanding(below, [below, above]);
    const aboveStanding = computeStanding(above, [below, above]);

    // Bands remain useful labels, but no longer select different production references.
    expect(belowStanding.peerLabel).toContain("$500-1000");
    expect(aboveStanding.peerLabel).toContain("$1000-2000");
    expect(Math.abs(
      belowStanding.dimensions.movement!.reference! - aboveStanding.dimensions.movement!.reference!
    )).toBeLessThan(0.001);
    expect(Math.abs(belowStanding.valueScore! - aboveStanding.valueScore!)).toBeLessThan(0.001);
  });

  it("does not turn one narrow case flag into a case-quality verdict or value penalty", () => {
    const omega = makeWatch({
      scoringCategory: "diver",
      price: { amount: 7100, currency: "USD" },
      specs: {
        caliber: "Co-Axial Master Chronometer 8800",
        powerReserveHours: 55,
        caseDiameterMm: 42,
        caseThicknessMm: 13.7,
        waterResistanceM: 300,
        crystal: "Sapphire",
      },
      qualityFlags: {
        antimagneticAm: 1200000,
        sapphireBezelInsert: false,
        braceletIncluded: true,
      },
    });
    const withoutNarrowCaseFlag = makeWatch({
      ...omega,
      qualityFlags: { antimagneticAm: 1200000, braceletIncluded: true },
    });

    const standing = computeStanding(omega, [omega]);
    const comparison = computeStanding(withoutNarrowCaseFlag, [withoutNarrowCaseFlag]);
    expect(standing.dimensions.caseCraft?.coverage).toBe(0.25);
    expect(standing.beats).not.toContain("caseCraft");
    expect(standing.trails).not.toContain("caseCraft");
    expect(standing.valueScore).toBeCloseTo(comparison.valueScore!);
  });

  it("only reports a percentile once the peer group reaches six members", () => {
    const diverAt = (amount: number, thickness: number) =>
      makeWatch({
        tags: ["diver"],
        price: { amount, currency: "USD" },
        specs: {
          caliber: "Seiko NH35",
          caseDiameterMm: 40,
          caseThicknessMm: thickness,
          waterResistanceM: 200,
          crystal: "Sapphire",
        },
      });
    const group = [11, 12, 13, 14, 15, 16].map((thickness) => diverAt(700, thickness));

    const standing = computeStanding(group[0], group);
    expect(standing.peerCount).toBe(6);
    expect(standing.qualityPercentile).toBe(1);
    expect(computeStanding(group[5], group).qualityPercentile).toBe(0);
  });
});

describe("percentile", () => {
  it("returns undefined for pools smaller than six", () => {
    expect(percentile(0.5, [0.1, 0.2, 0.3, 0.4, 0.9])).toBeUndefined();
  });

  it("ranks within pools of six or more", () => {
    expect(percentile(0.5, [0.1, 0.2, 0.3, 0.4, 0.5, 0.9])).toBe(0.8);
  });
});

describe("evidence confidence", () => {
  it("uses stable low, medium, and high thresholds", () => {
    expect(confidenceFor(0.49)).toBe("low");
    expect(confidenceFor(0.5)).toBe("medium");
    expect(confidenceFor(0.79)).toBe("medium");
    expect(confidenceFor(0.8)).toBe("high");
  });

  it("excludes a known strap-only bracelet from overall evidence coverage", () => {
    const watch = makeWatch({ qualityFlags: { braceletIncluded: false } });
    expect(computeStanding(watch, [watch]).evidenceCoverage).toBe(0);
  });
});

describe("design score", () => {
  it("maps 1-5 ratings to semantic band centers", () => {
    expect(computeDesignScore(makeWatch({ designUniqueness: 1 }))).toBe(10);
    expect(computeDesignScore(makeWatch({ designUniqueness: 3 }))).toBe(50);
    expect(computeDesignScore(makeWatch({ designUniqueness: 5 }))).toBe(90);
  });

  it("returns null for an unranked watch rather than a neutral middle", () => {
    // A neutral fill would park every unranked watch on the median line and
    // read as an opinion that was never given.
    expect(computeDesignScore(makeWatch())).toBeNull();
  });

  it("rejects out-of-range and non-integer ranks", () => {
    expect(computeDesignScore(makeWatch({ designUniqueness: 0 }))).toBeNull();
    expect(computeDesignScore(makeWatch({ designUniqueness: 6 }))).toBeNull();
    expect(computeDesignScore(makeWatch({ designUniqueness: 3.5 }))).toBeNull();
  });

  it("ignores the wishlist tier, which the matrix exists to inform", () => {
    const mustHave = makeWatch({ wishlistTier: "shortlist" });
    const pass = makeWatch({ wishlistTier: "pass" });
    expect(computeDesignScore(mustHave)).toBe(computeDesignScore(pass));
  });

  it("uses pairwise preferences to spread watches without crossing appeal bands", () => {
    const preferred = computeDesignScore(
      makeWatch({ designUniqueness: 4, designPreferenceElo: 1016, designComparisonCount: 1 })
    )!;
    const other = computeDesignScore(
      makeWatch({ designUniqueness: 4, designPreferenceElo: 984, designComparisonCount: 1 })
    )!;
    expect(preferred).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(60);
    expect(preferred).toBeLessThan(80);
  });
});

describe("updateDesignElo", () => {
  it("rewards the preferred design and handles ties symmetrically", () => {
    expect(updateDesignElo(1000, 1000, "left")).toEqual({ left: 1016, right: 984 });
    expect(updateDesignElo(1000, 1000, "right")).toEqual({ left: 984, right: 1016 });
    expect(updateDesignElo(1000, 1000, "tie")).toEqual({ left: 1000, right: 1000 });
  });
});

describe("medianScore", () => {
  it("returns null for an empty set so callers can choose their own fallback", () => {
    expect(medianScore([])).toBeNull();
  });

  it("averages the middle pair for an even count", () => {
    expect(medianScore([0, 25, 75, 100])).toBe(50);
    expect(medianScore([100, 0, 50])).toBe(50);
  });
});

describe("assignQuadrant", () => {
  const thresholds = { value: 50, design: 50 };

  it("places a watch by both axes", () => {
    expect(assignQuadrant(60, 60, thresholds)).toBe("buy");
    expect(assignQuadrant(40, 60, thresholds)).toBe("aspirational");
    expect(assignQuadrant(60, 40, thresholds)).toBe("sensible");
    expect(assignQuadrant(40, 40, thresholds)).toBe("skip");
  });

  it("gives no quadrant when either axis is missing", () => {
    expect(assignQuadrant(null, 60, thresholds)).toBeNull();
    expect(assignQuadrant(60, null, thresholds)).toBeNull();
  });
});

describe("currency conversion", () => {
  // The entry form offers every code in CURRENCIES. Any one missing from the
  // rate table falls back to 1.0, which silently scores 3000 SEK as $3000 and
  // lands the watch several price bands too high.
  it("has a rate for every currency the form offers", () => {
    const missing = CURRENCIES.filter((code) => CURRENCY_TO_USD[code] === undefined);
    expect(missing).toEqual([]);
  });

  it("has no rate that is implausibly far from 1, except JPY-like minor units", () => {
    for (const [code, rate] of Object.entries(CURRENCY_TO_USD)) {
      expect(rate, `${code} rate`).toBeGreaterThan(0);
      expect(rate, `${code} rate`).toBeLessThan(10);
    }
  });

  it("converts a foreign amount using the table", () => {
    const usd = normalizePriceToUsd({ amount: 100, currency: "EUR" });
    expect(usd).toBeCloseTo(100 * CURRENCY_TO_USD.EUR);
  });

  it("warns and passes the amount through for an unknown currency", () => {
    const warnings: string[] = [];
    const usd = normalizePriceToUsd({ amount: 100, currency: "XYZ" }, (m) => warnings.push(m));
    expect(usd).toBe(100);
    expect(warnings).toHaveLength(1);
  });

  it("normalizes case and padding before lookup", () => {
    expect(normalizePriceToUsd({ amount: 10, currency: " eur " })).toBeCloseTo(10 * CURRENCY_TO_USD.EUR);
  });

  it("orders watch prices by normalized landed cost rather than raw amounts", () => {
    const euros = makeWatch({ price: { amount: 900, currency: "EUR" } });
    const dollars = makeWatch({ price: { amount: 950, currency: "USD" } });
    expect(landedPriceUsd(euros)!).toBeGreaterThan(landedPriceUsd(dollars)!);

    const landed = makeWatch({
      price: { amount: 800, currency: "USD" },
      landedPrice: { amount: 1000, currency: "USD" },
    });
    expect(landedPriceUsd(landed)).toBe(1000);
  });
});

describe("rate staleness", () => {
  const asOf = new Date(`${RATES_AS_OF}T00:00:00Z`);
  const daysAfter = (n: number) => new Date(asOf.getTime() + n * 86_400_000);

  it("is zero days old on the day the rates were taken", () => {
    expect(ratesAgeDays(asOf)).toBe(0);
    expect(ratesAreStale(asOf)).toBe(false);
  });

  it("counts whole days elapsed", () => {
    expect(ratesAgeDays(daysAfter(45))).toBe(45);
  });

  it("is not stale on the threshold day itself", () => {
    expect(ratesAreStale(daysAfter(RATES_STALE_AFTER_DAYS))).toBe(false);
  });

  it("goes stale the day after the threshold", () => {
    expect(ratesAreStale(daysAfter(RATES_STALE_AFTER_DAYS + 1))).toBe(true);
  });

  it("reports a negative age rather than throwing if the date is in the future", () => {
    expect(ratesAgeDays(daysAfter(-10))).toBe(-10);
    expect(ratesAreStale(daysAfter(-10))).toBe(false);
  });
});

describe("value for money", () => {
  const complete = (overrides: Partial<Watch> = {}) =>
    makeWatch({
      scoringCategory: "diver",
      price: { amount: 800, currency: "USD" },
      specs: { caliber: "Sellita SW200-1", movement: "automatic", caseDiameterMm: 39, caseThicknessMm: 12, waterResistanceM: 200, crystal: "Sapphire" },
      ...overrides,
    });

  it("costs 10 points when the same specs cost twice as much", () => {
    const cheap = computeStanding(complete(), []).valueScore!;
    const dear = computeStanding(complete({ price: { amount: 1600, currency: "USD" } }), []).valueScore!;
    expect(cheap - dear).toBeCloseTo(0.1, 10);
    const coreSlope = VALUE_DIMENSIONS.reduce((sum, d) => sum + PAR[d].perDoubling, 0) / VALUE_DIMENSIONS.length;
    expect(coreSlope).toBeCloseTo(0.1, 10);
  });

  it("values identical specs at an identical price the same in every category", () => {
    const diver = computeStanding(complete(), []).valueScore;
    const dress = computeStanding(complete({ scoringCategory: "dress", tags: ["dress"] }), []).valueScore;
    expect(dress).toBe(diver);
  });

  it("leaves a quartz watch's value unrated rather than valuing it on case and durability alone", () => {
    const quartz = complete({ specs: { ...complete().specs, caliber: "Seiko VK64", movement: "quartz" } });
    const standing = computeStanding(quartz, []);
    expect(standing.dimensions.wearability).toBeDefined();
    expect(standing.dimensions.durability).toBeDefined();
    expect(standing.valueScore).toBeUndefined();
  });

  it("needs both durability inputs before valuing a watch", () => {
    const noCrystal = complete({ specs: { ...complete().specs, crystal: undefined } });
    expect(computeStanding(noCrystal, []).valueScore).toBeUndefined();
  });

  it("does not let durability par rise past what a watch can score", () => {
    for (const price of [100, 1000, 10000, 50000]) expect(dimensionPar("durability", price)).toBeLessThanOrEqual(1);
  });

  it("keeps caseCraft and bracelet out of value", () => {
    const bare = complete();
    const flagged = complete({ qualityFlags: { hardenedCoatingHv: 1200, drilledLugs: true, braceletIncluded: true, microAdjustClasp: true } });
    expect(computeStanding(flagged, []).valueScore).toBe(computeStanding(bare, []).valueScore);
    expect(valueFromEvidence({}, 800)).toBeUndefined();
  });
});

describe("accuracy spec as regulation", () => {
  it("credits a stated accuracy linearly from ±20 s/d (nothing) to ±2 s/d (full 0.2)", () => {
    expect(accuracyCredit(40)).toBe(0);
    expect(accuracyCredit(20)).toBe(0);
    expect(accuracyCredit(6)).toBeCloseTo(0.156, 3); // COSC -4/+6
    expect(accuracyCredit(2)).toBe(0.2);
  });

  it("shares one credit with regulated positions, the larger, never both", () => {
    const base = { caliber: "SW200-1", movement: "automatic" as const };
    const movement = (qualityFlags: Watch["qualityFlags"]) =>
      scoreDimensionEvidence(makeWatch({ specs: base, qualityFlags })).movement!.raw;
    const positions4 = movement({ regulatedPositions: 4 });
    expect(movement({ regulatedPositions: 4, accuracySpecSpd: 6 })).toBeCloseTo(positions4, 6);
    expect(movement({ accuracySpecSpd: 2 })).toBeCloseTo(positions4, 6);
    expect(movement({ accuracySpecSpd: 6 })).toBeGreaterThan(movement({}));
  });

  it("counts a stated accuracy as the regulation input being known", () => {
    const watch = makeWatch({ specs: { caliber: "SW200-1", movement: "automatic" }, qualityFlags: { accuracySpecSpd: 10 } });
    expect(scoreDimensionEvidence(watch).movement!.knownInputs).toBe(2);
  });
});

describe("chronograph thickness allowance", () => {
  const specs = { caseDiameterMm: 41, caseThicknessMm: 14.27 };

  it("expects a chronograph caliber's case to be taller by the module", () => {
    const chrono = scoreDimensionEvidence(makeWatch({ specs: { ...specs, caliber: "Sellita SW510", movement: "automatic" } })).wearability!.raw;
    expect(chrono).toBeCloseTo(caseProfileEvidence(specs, CHRONOGRAPH_THICKNESS_ALLOWANCE_MM)!.raw, 6);
    expect(chrono).toBeGreaterThan(caseProfileEvidence(specs)!.raw);
  });

  it("reads the caliber, not the category or the complications text", () => {
    const threeHand = scoreDimensionEvidence(makeWatch({
      scoringCategory: "chronograph",
      specs: { ...specs, caliber: "SW200-1", movement: "automatic", complications: "Chronograph" },
    })).wearability!.raw;
    expect(threeHand).toBeCloseTo(caseProfileEvidence(specs)!.raw, 6);
  });
});

describe("dimensionVerdict", () => {
  it("reads a score at the ceiling as top of scale once par has passed it, not as trailing", () => {
    expect(dimensionVerdict("movement", 1, 1.14, 0.67)).toBe("top");
    expect(dimensionVerdict("movement", 0.96, 1.14, 0.67)).toBe("top");
  });

  it("keeps full marks against a par of exactly 1 as expected (durability at any price)", () => {
    expect(dimensionVerdict("durability", 1, 1, 1)).toBe("par");
  });

  it("still trails when the score is short of the ceiling", () => {
    expect(dimensionVerdict("movement", 0.9, 1.14, 0.67)).toBe("trails");
    expect(dimensionVerdict("movement", 0.5, 0.7, 0.67)).toBe("trails");
  });

  it("keeps beats, par, limited and unbanded as before", () => {
    expect(dimensionVerdict("movement", 0.9, 0.7, 0.67)).toBe("beats");
    expect(dimensionVerdict("movement", 0.72, 0.7, 0.67)).toBe("par");
    expect(dimensionVerdict("movement", 1, 1.14, 0.2)).toBe("limited");
    expect(dimensionVerdict("movement", 1, undefined, 1)).toBe("unbanded");
  });

  it("leaves value unchanged: a dearer watch with the same specs is still worse value", () => {
    const specs = { caliber: "3285", movement: "automatic" as const, powerReserveHours: 70, caseDiameterMm: 40, caseThicknessMm: 12, waterResistanceM: 100, crystal: "Sapphire" };
    const at = (amount: number) => computeStanding(makeWatch({ specs, price: { amount, currency: "USD" } }), []).valueScore!;
    expect(at(12000)).toBeLessThan(at(8000));
    const standing = computeStanding(makeWatch({ specs, price: { amount: 12000, currency: "USD" } }), []);
    expect(standing.trails).not.toContain("movement");
  });
});
