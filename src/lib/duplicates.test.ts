import { describe, expect, it } from "vitest";
import { findDuplicates, normalizeProductUrl, type TrackedWatchKey } from "./duplicates";

const tracked: TrackedWatchKey[] = [
  { id: "a", label: "Baltic Aquascaphe MK2 Blue", brand: "Baltic", urls: ["https://baltic-watches.com/products/aquascaphe-mk2-blue"] },
  { id: "b", label: "Rolex GMT-Master II", brand: "Rolex", referenceNumber: "126710BLNR", urls: ["https://www.rolex.com/en-us/watches/gmt-master-ii/m126710blnr-0002"] },
];

describe("normalizeProductUrl", () => {
  it("ignores www, case, trailing slashes and query strings", () => {
    expect(normalizeProductUrl("https://WWW.Baltic-Watches.com/products/Aquascaphe-MK2-Blue/?utm_source=x")).toBe(
      "baltic-watches.com/products/aquascaphe-mk2-blue"
    );
  });

  it("returns nothing for text that isn't a URL", () => {
    expect(normalizeProductUrl("baltic aquascaphe")).toBeUndefined();
  });
});

describe("findDuplicates", () => {
  it("matches the same product page", () => {
    expect(findDuplicates({ brand: "", urls: ["https://www.baltic-watches.com/products/aquascaphe-mk2-blue?variant=1"] }, tracked)).toEqual([
      { id: "a", label: "Baltic Aquascaphe MK2 Blue", reason: "same-page" },
    ]);
  });

  it("matches brand and reference, ignoring case and separators", () => {
    expect(findDuplicates({ brand: "rolex", referenceNumber: "126710-blnr", urls: [] }, tracked)).toEqual([
      { id: "b", label: "Rolex GMT-Master II", reason: "same-reference" },
    ]);
  });

  it("doesn't match a reference under another brand, or a missing one", () => {
    expect(findDuplicates({ brand: "Tudor", referenceNumber: "126710BLNR", urls: [] }, tracked)).toEqual([]);
    expect(findDuplicates({ brand: "Baltic", urls: [] }, tracked)).toEqual([]);
  });

  it("finds nothing for a new watch", () => {
    expect(findDuplicates({ brand: "Farer", referenceNumber: "W-NEV-40", urls: ["https://usd.farer.com/products/nevada"] }, tracked)).toEqual([]);
  });
});
