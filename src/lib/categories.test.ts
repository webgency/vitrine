import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RUBRIC_CATEGORIES } from "./rubrics";
import {
  CATEGORIES,
  CATEGORY_EXPECTATION,
  CATEGORY_WR_EXPECTATION,
  TAG_TO_CATEGORY,
  categoriesInTags,
  categoryFor,
  normalizeTags,
  tagLabel,
  resolveCategory,
} from "./categories";
import { deriveCategory } from "./scoring";
import type { Watch } from "./types";

describe("resolveCategory", () => {
  it("returns undefined rather than defaulting to dress", () => {
    // The whole point of Phase 0: the old `?? "dress"` graded untagged divers
    // against a 30m expectation they cleared tenfold, and scored them well for
    // it. Unknown must be unrated.
    expect(resolveCategory([])).toBeUndefined();
    expect(resolveCategory()).toBeUndefined();
    expect(resolveCategory(["titanium", "bronze"])).toBeUndefined();
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveCategory(["GMT"])).toBe("gmt");
    expect(resolveCategory([" Chronograph "])).toBe("chronograph");
    expect(resolveCategory(["CHRONOGRAPH"])).toBe("chronograph");
  });

  it("accepts the synonym tags", () => {
    expect(resolveCategory(["dive"])).toBe("diver");
    expect(resolveCategory(["worldtimer"])).toBe("gmt");
    expect(resolveCategory(["formal"])).toBe("dress");
    expect(resolveCategory(["field"])).toBe("sports");
  });

  it("gives tag[0] precedence, by convention", () => {
    // Documented convention, not an accident: tag[0] is the scoring category.
    // It only decides watches with no explicit scoringCategory — see the
    // agreement test below.
    expect(resolveCategory(["GMT", "diver"])).toBe("gmt");
    expect(resolveCategory(["diver", "GMT"])).toBe("diver");
  });

  it("skips non-string tags without throwing", () => {
    expect(resolveCategory([null as unknown as string, "diver"])).toBe("diver");
  });
});

describe("categoryFor", () => {
  it("prefers the explicit field over the tags", () => {
    expect(categoryFor({ scoringCategory: "gmt", tags: ["chronograph"] })).toBe("gmt");
  });

  it("falls back to tags, then to undefined", () => {
    expect(categoryFor({ tags: ["dress"] })).toBe("dress");
    expect(categoryFor({ tags: [] })).toBeUndefined();
  });
});

describe("normalizeTags", () => {
  it("lowercases, trims and de-duplicates while preserving order", () => {
    expect(normalizeTags(["GMT", " diver ", "gmt", ""])).toEqual(["gmt", "diver"]);
  });

  it("returns an empty array for nothing", () => {
    expect(normalizeTags()).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });
});

describe("RUBRIC_CATEGORIES", () => {
  it("covers every category a tag can resolve to", () => {
    // A tag resolving to a category outside the list leaves the watch with no
    // peer label and fails audit:data, so this must stay exhaustive.
    const resolvable = new Set(Object.values(TAG_TO_CATEGORY));
    expect([...resolvable].filter((c) => !RUBRIC_CATEGORIES.includes(c))).toEqual([]);
  });
});

describe("CATEGORY_EXPECTATION", () => {
  it("covers all five categories", () => {
    expect(Object.keys(CATEGORY_EXPECTATION).sort()).toEqual([...CATEGORIES].sort());
  });

  it("keeps the bare-Node copy of the water-resistance bar in step", () => {
    // audit-data.mjs cannot import TypeScript, so category-tags.mjs carries its
    // own copy of the wrM numbers. This is what stops the two drifting.
    const fromExpectation = Object.fromEntries(
      Object.entries(CATEGORY_EXPECTATION).map(([k, v]) => [k, v.wrM])
    );
    expect(CATEGORY_WR_EXPECTATION).toEqual(fromExpectation);
  });

  it("puts sports at 100m — above a dress watch, below a diver", () => {
    expect(CATEGORY_EXPECTATION.sports.wrM).toBe(100);
    expect(CATEGORY_EXPECTATION.sports.wrM).toBeGreaterThan(CATEGORY_EXPECTATION.dress.wrM);
    expect(CATEGORY_EXPECTATION.sports.wrM).toBeLessThan(CATEGORY_EXPECTATION.diver.wrM);
    expect(CATEGORY_EXPECTATION.sports.needsBezel).toBe(false);
  });
});

describe("agreement with the shipped scoring engine", () => {
  const raw = JSON.parse(readFileSync(new URL("../../data/watches.json", import.meta.url), "utf8"));
  const watches: Watch[] = Array.isArray(raw) ? raw : raw.watches;

  it("never lets tag order pick a rubric the engine would refuse", () => {
    // deriveCategory() returns undefined for an ambiguous tag set on purpose:
    // ordering must not decide which rubric a hybrid gets. resolveCategory()
    // does use order, so every hybrid in the collection must carry an explicit
    // scoringCategory for the two to agree. If a hybrid is ever added without
    // one, this fails rather than the audit quietly reporting it resolved.
    const hybridsWithoutExplicit = watches
      .filter((w) => categoriesInTags(w.tags ?? []).length > 1 && !w.scoringCategory)
      .map((w) => `${w.id}: ${JSON.stringify(w.tags)}`);
    expect(hybridsWithoutExplicit).toEqual([]);
  });

  it("resolves every watch the engine resolves, and no others", () => {
    // Both read the same tag table now, so there is no carve-out left. There
    // used to be one for sports, which RUBRICS had no column for.
    const disagreements = watches
      .filter((w) => (categoryFor(w) ?? null) !== (deriveCategory(w) ?? null))
      .map((w) => `${w.id}: categories=${categoryFor(w)} scoring=${deriveCategory(w)}`);
    expect(disagreements).toEqual([]);
  });

  it("scores the sports watches it resolves", () => {
    const sports = watches.filter((w) => categoryFor(w) === "sports");
    expect(sports.length).toBeGreaterThan(0);
    expect(sports.every((w) => deriveCategory(w) === "sports")).toBe(true);
  });
});

describe("tagLabel", () => {
  it("restores the casing a lowercase tag loses, and leaves the rest", () => {
    expect(tagLabel("gmt")).toBe("GMT");
    expect(tagLabel("diver")).toBe("diver");
  });
});
