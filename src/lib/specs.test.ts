import { describe, expect, it } from "vitest";
import {
  QUALITY_FLAG_FIELDS,
  QUALITY_FLAG_NO,
  QUALITY_FLAG_UNSET,
  qualityFlagsFromForm,
  qualityFlagsToForm,
} from "./specs";
import { scoreDimensionEvidence, scoreDimensions, unratedReason } from "./scoring";
import { QualityFlags, Watch } from "./types";

/** Form values with every flag left unrecorded. */
function blankForm(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of QUALITY_FLAG_FIELDS) values[field.key] = QUALITY_FLAG_UNSET;
  return values;
}

function makeWatch(qualityFlags: QualityFlags): Watch {
  return {
    id: "t1",
    brand: "Test",
    model: "Test",
    status: "wishlist",
    specs: {},
    qualityFlags,
    tags: [],
    links: [],
    dateAdded: "2026-01-01T00:00:00.000Z",
  };
}

describe("quality flag form conversion", () => {
  // The entry form holds flags as strings because the store has three states,
  // not two. These tests exist because a checkbox — the obvious control —
  // cannot express the middle one, and collapsing it fabricates evidence.
  it("writes no key for a flag left unrecorded", () => {
    const values = blankForm();
    values.arLayers = "6";
    const flags = qualityFlagsFromForm(values);
    expect(flags).toEqual({ arLayers: 6 });
    // Not merely falsy — the keys must be absent, or scoreDimensions treats
    // them as recorded and scores the dimension against them.
    expect("sapphireBezelInsert" in flags!).toBe(false);
    expect("braceletIncluded" in flags!).toBe(false);
  });

  it("keeps a recorded false distinct from an unrecorded flag", () => {
    const values = blankForm();
    values.drilledLugs = "no";
    const flags = qualityFlagsFromForm(values);
    expect(flags).toEqual({ drilledLugs: false });
    expect(flags!.drilledLugs).toBe(false);
  });

  it("returns undefined when nothing is recorded, so the patch clears", () => {
    // Distinct from {}: the form sends undefined as null and the PATCH drops
    // the object, rather than leaving a stale one behind.
    expect(qualityFlagsFromForm(blankForm())).toBeUndefined();
  });

  it("ignores a number field that is not a number", () => {
    const values = blankForm();
    values.arLayers = "six";
    expect(qualityFlagsFromForm(values)).toBeUndefined();
  });

  it("round-trips stored flags through the form unchanged", () => {
    const stored: QualityFlags = {
      arLayers: 6,
      drilledLugs: true,
      braceletIncluded: false,
      regulatedPositions: 5,
      antimagneticAm: 25000,
    };
    expect(qualityFlagsFromForm(qualityFlagsToForm(stored))).toEqual(stored);
  });

  it("does not turn a stored false into an unrecorded flag when editing", () => {
    // The regression that matters on the edit path: reload a strap-only watch,
    // save it untouched, and braceletIncluded must survive as false.
    const values = qualityFlagsToForm({ braceletIncluded: false });
    expect(values.braceletIncluded).toBe("no");
    expect(values.microAdjustClasp).toBe(QUALITY_FLAG_UNSET);
    expect(qualityFlagsFromForm(values)).toEqual({ braceletIncluded: false });
  });
});

describe("quality flags reaching the scoring engine", () => {
  it("leaves a dimension unrated when the form recorded none of its flags", () => {
    const flags = qualityFlagsFromForm({ ...blankForm(), regulatedPositions: "2" })!;
    const scored = scoreDimensions(makeWatch(flags));
    expect(scored.caseCraft).toBeUndefined();
    expect(scored.bracelet).toBeUndefined();
  });

  it("reads a recorded 'no' on bracelet as not applicable, not as a bad bracelet", () => {
    const flags = qualityFlagsFromForm({ ...blankForm(), braceletIncluded: "no" })!;
    const watch = makeWatch(flags);
    expect(scoreDimensions(watch).bracelet).toBeUndefined();
    expect(unratedReason(watch, "bracelet")).toBe("Ships on a strap — no bracelet to rate");
  });

  it("rates caseCraft once the form records one of its flags", () => {
    const flags = qualityFlagsFromForm({ ...blankForm(), drilledLugs: "yes" })!;
    // Its one known input fully achieved; coverage records how little that is.
    expect(scoreDimensions(makeWatch(flags)).caseCraft).toBeCloseTo(1, 5);
  });
});

describe("AR coating recorded without a layer count", () => {
  it("rates caseCraft from arCoated alone", () => {
    // The gap this closes: brands routinely say "anti-reflective coated" and
    // never publish a count, so the fact was unrecordable and caseCraft went
    // unrated on watches whose coating was stated outright.
    const rated = scoreDimensions(makeWatch({ arCoated: true }));
    expect(rated.caseCraft).toBeDefined();
    expect(unratedReason(makeWatch({}), "caseCraft")).toBe("No finishing details recorded");
  });

  it("credits one layer, less than a published count", () => {
    const coated = scoreDimensions(makeWatch({ arCoated: true }));
    const oneLayer = scoreDimensions(makeWatch({ arLayers: 1 }));
    const fourLayers = scoreDimensions(makeWatch({ arLayers: 4 }));
    expect(coated.caseCraft).toBeCloseTo(oneLayer.caseCraft!, 10);
    expect(coated.caseCraft!).toBeLessThan(fourLayers.caseCraft!);
  });

  it("treats a recorded absence as absence, not as a missing input", () => {
    const notCoated = scoreDimensionEvidence(makeWatch({ arCoated: false }));
    // Rated, because the fact is known — and it adds nothing, because there
    // is no coating to credit.
    expect(notCoated.caseCraft).toBeDefined();
    expect(notCoated.caseCraft!.raw).toBeCloseTo(0.35, 10);
    expect(notCoated.caseCraft!.knownInputs).toBe(1);
  });

  it("lets a published count win over the coarse flag", () => {
    const both = scoreDimensions(makeWatch({ arLayers: 6, arCoated: true }));
    const countOnly = scoreDimensions(makeWatch({ arLayers: 6 }));
    expect(both.caseCraft).toBeCloseTo(countOnly.caseCraft!, 10);
  });

  it("counts AR as one input however it was recorded", () => {
    // The reason arCoated is not a fifth flag: a fifth would silently cut the
    // coverage of every record already in the file, dropping some under
    // MIN_REFERENCE_COVERAGE without their data changing.
    for (const flags of [{ arLayers: 2 }, { arCoated: true }, { arLayers: 2, arCoated: true }]) {
      const ev = scoreDimensionEvidence(makeWatch(flags)).caseCraft!;
      expect(ev.totalInputs).toBe(4);
      expect(ev.knownInputs).toBe(1);
    }
  });

  it("round-trips through the form", () => {
    const values = qualityFlagsToForm({ arCoated: false });
    expect(values.arCoated).toBe(QUALITY_FLAG_NO);
    expect(qualityFlagsFromForm(values)?.arCoated).toBe(false);
    const blank = qualityFlagsToForm({});
    expect(blank.arCoated).toBe(QUALITY_FLAG_UNSET);
    // An all-blank form records nothing at all, rather than a flag set to false.
    expect(qualityFlagsFromForm(blank)).toBeUndefined();
  });
});
