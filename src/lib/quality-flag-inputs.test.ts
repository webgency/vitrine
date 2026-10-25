import { describe, expect, it } from "vitest";
import { BRACELET_FLAG_KEYS, CASE_CRAFT_FLAG_KEYS } from "./quality-flag-inputs.mjs";
import { QUALITY_FLAG_FIELDS } from "./specs";
import { scoreDimensionEvidence } from "./scoring";
import type { Dimension } from "./rubrics";
import type { QualityFlags, Watch } from "./types";

function watchWith(qualityFlags: QualityFlags): Watch {
  return {
    id: "t1",
    brand: "Test",
    model: "Test",
    status: "wishlist",
    specs: {},
    tags: [],
    links: [],
    dateAdded: "2026-01-01T00:00:00Z",
    qualityFlags,
  };
}

/**
 * A value that counts as "recorded" for this flag. `true` rather than `false`
 * for booleans on purpose: braceletIncluded false means "ships on a strap" and
 * removes the bracelet dimension instead of rating it, which would make this
 * measure the wrong thing.
 */
function sampleValue(type: string): number | boolean {
  return type === "boolean" ? true : 1;
}

/** Every flag that, recorded on its own, makes `dimension` rated. */
function flagsThatRate(dimension: Dimension): string[] {
  return QUALITY_FLAG_FIELDS.filter((field) => {
    const flags = { [field.key]: sampleValue(field.type) } as QualityFlags;
    return scoreDimensionEvidence(watchWith(flags))[dimension] !== undefined;
  }).map((field) => String(field.key));
}

// scripts/audit-data.mjs cannot import scoring.ts — it runs under bare Node
// with no build step — so it reads these key lists instead. They were a
// hand-kept copy until the audit reported caseCraft coverage of 38/66 while
// the engine saw 41/66, having missed a flag added to scoring.ts. This is what
// stops that recurring.
describe("the audit's quality-flag lists match what the engine reads", () => {
  it("lists exactly the flags that rate caseCraft", () => {
    // Both directions matter, and the second is the one that bit: a flag the
    // engine reads but the list omits silently under-reports coverage.
    expect(flagsThatRate("caseCraft").sort()).toEqual([...CASE_CRAFT_FLAG_KEYS].sort());
  });

  it("lists exactly the flags that rate bracelet", () => {
    expect(flagsThatRate("bracelet").sort()).toEqual([...BRACELET_FLAG_KEYS].sort());
  });

  it("covers every flag the form can record", () => {
    // Guards the enumeration itself: if a flag existed on QualityFlags but not
    // in QUALITY_FLAG_FIELDS, the checks above would never see it and could
    // pass while the lists were wrong.
    const declared = new Set(QUALITY_FLAG_FIELDS.map((f) => String(f.key)));
    for (const key of [...CASE_CRAFT_FLAG_KEYS, ...BRACELET_FLAG_KEYS]) {
      expect(declared).toContain(key);
    }
  });

  it("keeps caseCraft at four inputs despite six keys", () => {
    // arLayers and arCoated are one input recorded at two precisions, and
    // sapphireBezelInsert and ceramicBezelInsert are the one bezel input. If a
    // key is ever added as a genuinely new input, this fails and the coverage
    // denominator has to be considered rather than drift.
    const ev = scoreDimensionEvidence(watchWith({ arCoated: true })).caseCraft!;
    expect(ev.totalInputs).toBe(4);
    expect(CASE_CRAFT_FLAG_KEYS).toHaveLength(6);
    const bothBezels = scoreDimensionEvidence(watchWith({ sapphireBezelInsert: false, ceramicBezelInsert: true })).caseCraft!;
    expect(bothBezels.knownInputs).toBe(1);
  });
});
