import { describe, expect, it } from "vitest";
import { ownershipItems } from "./ownership";

describe("ownershipItems", () => {
  it("collapses every panel that has nothing to show, naming what's missing", () => {
    const items = ownershipItems({ purchaseRecorded: false, exitSources: 0, listingState: "none" });
    expect(items.map((item) => [item.key, item.open])).toEqual([
      ["purchase", false],
      ["trade-up", false],
      ["sell", false],
    ]);
    expect(items[1].missing).toBe("Add 2 pre-owned listings to estimate your exit range");
  });

  it("counts down the pre-owned listings still needed", () => {
    expect(ownershipItems({ exitSources: 1 })[0].missing).toBe("Add 1 pre-owned listing to estimate your exit range");
  });

  it("opens each panel once it has input", () => {
    const items = ownershipItems({ purchaseRecorded: true, exitSources: 2, listingState: "draft" });
    expect(items.every((item) => item.open && item.missing === undefined)).toBe(true);
  });

  it("omits panels the page doesn't render, as on the static export", () => {
    expect(ownershipItems({ exitSources: 0 }).map((item) => item.key)).toEqual(["trade-up"]);
  });
});
