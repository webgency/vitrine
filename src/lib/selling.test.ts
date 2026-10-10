import { describe, expect, it } from "vitest";
import { netProceeds } from "./proceeds";
import { parseListingFields, parseSoldFields } from "./sale-entry";
import { draftListingText } from "./listing-text";
import { publishedListingErrors } from "./listing-shape.mjs";
import { marketValueSummary } from "./valuation";
import { tradeUpModel } from "./trade-up";
import { normalizeWatchPatch, validateWatchCollection } from "./validation";
import { CURRENCIES, type RetailerLink, type SaleListing, type Watch } from "./types";

const usd = (amount: number) => ({ amount, currency: "USD" });
const now = new Date("2026-10-10T12:00:00Z");
const currencies = new Set(CURRENCIES);

const listing: SaleListing = {
  state: "live",
  listedAt: "2026-10-01T00:00:00Z",
  askingPrice: usd(400),
  grade: "very-good",
  included: ["Box"],
  photos: ["listings/w1/0123456789abcdef.jpg"],
  postings: [{ platform: "Chrono24", url: "https://www.chrono24.com/x", askingPrice: usd(450), postedAt: "2026-10-02" }],
};

describe("net proceeds", () => {
  it("is unknown, never the gross, while any cost is missing", () => {
    expect(netProceeds(usd(700), undefined, usd(0))).toMatchObject({ status: "unknown", missing: ["fees"] });
    expect(netProceeds(usd(700), [{ label: "PayPal" }], usd(0))).toMatchObject({ status: "unknown", missing: ["PayPal"] });
    expect(netProceeds(usd(700), [], undefined)).toMatchObject({ status: "unknown", missing: ["shipping"] });
  });

  it("is exact when every input is stated, including stated zeros", () => {
    expect(netProceeds(usd(700), [{ label: "PayPal", amount: usd(24) }, { label: "Forum", amount: usd(0) }], usd(15)))
      .toEqual({ status: "known", grossUsd: 700, costsUsd: 39, netUsd: 661 });
    expect(netProceeds(usd(700), [], usd(0))).toEqual({ status: "known", grossUsd: 700, costsUsd: 0, netUsd: 700 });
  });
});

describe("your own ask is never market evidence", () => {
  const links: RetailerLink[] = [
    { url: "https://a.example/w", price: usd(500), condition: "pre-owned", observedAt: "2026-10-05" },
    { url: "https://b.example/w", price: usd(600), condition: "pre-owned", observedAt: "2026-10-06" },
  ];
  const watch: Watch = { id: "w1", brand: "B", model: "M", status: "owned", links, specs: {}, tags: [], dateAdded: "2026-01-01" };

  it("leaves the market summary and trade-up exit identical when a listing (with postings) is added", () => {
    const listed = { ...watch, listing };
    expect(marketValueSummary(listed, "pre-owned", now)).toEqual(marketValueSummary(watch, "pre-owned", now));
    expect(tradeUpModel(listed, [listed], now)!.exit).toEqual(tradeUpModel(watch, [watch], now)!.exit);
  });
});

describe("listing shape", () => {
  it("accepts a published listing on an owned watch", () => {
    expect(publishedListingErrors(listing, "listing", { currencies, watchId: "w1", status: "owned" })).toEqual([]);
  });

  it("refuses a published listing with no photos, on a sold watch, or with another watch's photo", () => {
    expect(publishedListingErrors({ ...listing, photos: [] }, "listing", { currencies, watchId: "w1", status: "owned" }).join(" ")).toMatch(/at least one/);
    expect(publishedListingErrors(listing, "listing", { currencies, watchId: "w1", status: "sold" }).join(" ")).toMatch(/owned/);
    expect(publishedListingErrors(listing, "listing", { currencies, watchId: "w2", status: "owned" }).join(" ")).toMatch(/listings\/w2/);
  });

  it("is accepted from the stored collection but refused through the edit API", () => {
    const stored = { id: "w1", brand: "B", model: "M", status: "owned", links: [], specs: {}, tags: [], dateAdded: "2026-01-01", listing };
    expect(validateWatchCollection([stored])[0].listing).toEqual(listing);
    const patch = normalizeWatchPatch({ listing });
    expect(patch.ok).toBe(false);
  });
});

describe("form parsing", () => {
  const listingFields = { state: "live", askingAmount: "700", currency: "usd", grade: "excellent", included: ["Box"], photos: ["data:image/jpeg;base64,AAAA"], postings: [], fees: [], noFees: false, minimumAmount: "" };

  it("treats untouched listing fees as not considered, and a ticked box as none", () => {
    const untouched = parseListingFields(listingFields, now);
    const none = parseListingFields({ ...listingFields, noFees: true }, now);
    expect(untouched.ok && untouched.value.listingFees).toBeUndefined();
    expect(none.ok && none.value.listingFees).toEqual([]);
  });

  it("keeps a fee with a blank amount as unknown, not zero", () => {
    const parsed = parseListingFields({ ...listingFields, fees: [{ label: "PayPal", amount: "" }] }, now);
    expect(parsed.ok && parsed.value.listingFees).toEqual([{ label: "PayPal" }]);
  });

  it("won't publish without a photo or with a minimum above the ask", () => {
    const noPhoto = parseListingFields({ ...listingFields, photos: [] }, now);
    const highMin = parseListingFields({ ...listingFields, minimumAmount: "800" }, now);
    expect(!noPhoto.ok && noPhoto.errors.photos).toBeTruthy();
    expect(!highMin.ok && highMin.errors.minimumAmount).toBeTruthy();
  });

  it("requires an answer about fees when closing a sale", () => {
    const base = { amount: "680", currency: "USD", date: "2026-10-09", channel: "Chrono24", countAs: "pre-owned", fees: [], noFees: false, shippingAmount: "", buyer: "", notes: "" };
    const unanswered = parseSoldFields(base, now);
    expect(!unanswered.ok && unanswered.errors.fees).toBeTruthy();
    const answered = parseSoldFields({ ...base, noFees: true, shippingAmount: "0" }, now);
    expect(answered.ok && answered.value.close).toEqual({ fees: [], shipping: usd(0) });
  });
});

describe("draft listing text", () => {
  it("states only recorded specs and never fills a gap", () => {
    const text = draftListingText(
      { brand: "Tissot", model: "Gentleman", specs: { caseDiameterMm: 40, caliber: "Powermatic 80" } },
      { grade: "excellent", included: [], askingPrice: usd(700) },
    );
    expect(text).toContain("Case diameter: 40 mm");
    expect(text).toContain("Caliber: Powermatic 80");
    expect(text).not.toContain("Water resistance");
    expect(text).toContain("Included: the watch only.");
  });
});
