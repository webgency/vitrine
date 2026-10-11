import { describe, expect, it } from "vitest";
import { observedAtForSave, toLinkRow } from "./link-rows";

const link = {
  url: "https://ubiqwatches.com/products/trek-aqualight",
  price: { amount: 459, currency: "USD" },
  condition: "new" as const,
  observedAt: "2026-10-10T15:56:08.146Z",
};

describe("link rows", () => {
  it("gives the date input a day and keeps the stored timestamp beside it", () => {
    expect(toLinkRow(link)).toMatchObject({ observedAt: "2026-10-10", storedObservedAt: "2026-10-10T15:56:08.146Z" });
  });

  it("saves the stored timestamp when the date wasn't touched", () => {
    expect(observedAtForSave(toLinkRow(link))).toBe("2026-10-10T15:56:08.146Z");
  });

  it("saves the new day when the date was changed or newly entered", () => {
    expect(observedAtForSave({ ...toLinkRow(link), observedAt: "2026-10-11" })).toBe("2026-10-11");
    expect(observedAtForSave({ observedAt: "2026-10-11" })).toBe("2026-10-11");
  });

  it("saves nothing when the date was cleared", () => {
    expect(observedAtForSave({ ...toLinkRow(link), observedAt: "" })).toBeUndefined();
  });
});
