import { describe, expect, it } from "vitest";
import { purchaseFieldsFor, purchaseFormIntent } from "./purchase-entry";

const today = new Date("2026-10-13T12:00:00Z");
const blank = purchaseFieldsFor();

describe("purchaseFormIntent", () => {
  it("skips blank fields when nothing is recorded", () => {
    expect(purchaseFormIntent(blank, undefined, today)).toEqual({ kind: "skip" });
  });

  it("saves a new purchase with only a price", () => {
    expect(purchaseFormIntent({ ...blank, amount: "235" }, undefined, today)).toEqual({
      kind: "save",
      purchase: { price: { amount: 235, currency: "USD" } },
    });
  });

  it("rejects a date or source without a price", () => {
    const intent = purchaseFormIntent({ ...blank, date: "2026-10-12" }, undefined, today);
    expect(intent.kind).toBe("invalid");
  });

  it("rejects a future date", () => {
    const intent = purchaseFormIntent({ ...blank, amount: "235", date: "2026-10-14" }, undefined, today);
    expect(intent).toMatchObject({ kind: "invalid", errors: { date: expect.any(String) } });
  });

  it("skips an unchanged stored purchase, so an edit doesn't rewrite private.json", () => {
    const stored = { price: { amount: 235, currency: "USD" }, date: "2026-10-12", source: "Brand site" };
    expect(purchaseFormIntent(purchaseFieldsFor(stored), stored, today)).toEqual({ kind: "skip" });
  });

  it("saves a changed stored purchase", () => {
    const stored = { price: { amount: 235, currency: "USD" } };
    expect(purchaseFormIntent({ ...purchaseFieldsFor(stored), source: "Brand site" }, stored, today)).toEqual({
      kind: "save",
      purchase: { price: { amount: 235, currency: "USD" }, source: "Brand site" },
    });
  });

  it("never clears a stored purchase: emptied fields are an error", () => {
    const stored = { price: { amount: 235, currency: "USD" } };
    const intent = purchaseFormIntent(blank, stored, today);
    expect(intent).toMatchObject({ kind: "invalid", errors: { amount: expect.stringContaining("Clear purchase") } });
  });
});
