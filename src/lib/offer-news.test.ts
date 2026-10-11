import { describe, expect, it } from "vitest";
import type { Watch } from "./types";
import { bestOffer, bestOfferTargetStatus } from "./valuation";
import { offerNews } from "./offer-news";

const NOW = new Date("2026-10-11T12:00:00Z");

function watchWith(overrides: Partial<Watch>): Watch {
  return {
    id: "w1",
    brand: "Test",
    model: "Watch",
    status: "wishlist",
    price: { amount: 599, currency: "USD" },
    links: [{ url: "https://shop.example/w", price: { amount: 599, currency: "USD" }, condition: "new", observedAt: "2026-10-10" }],
    specs: {},
    tags: [],
    dateAdded: "2026-01-01",
    ...overrides,
  };
}

function news(watch: Watch, trackedTargetMet = false) {
  const offer = bestOffer(watch, undefined, NOW);
  return offerNews(watch, offer, bestOfferTargetStatus(watch, offer), trackedTargetMet);
}

describe("offerNews", () => {
  it("omits the row when the only link restates the tracked price, fresh and new", () => {
    expect(news(watchWith({}))).toEqual([]);
  });

  it("keeps the row when another seller asks a different price", () => {
    const watch = watchWith({
      links: [
        { url: "https://shop.example/w", price: { amount: 599, currency: "USD" }, condition: "new", observedAt: "2026-10-10" },
        { url: "https://other.example/w", price: { amount: 549, currency: "USD" }, condition: "new", observedAt: "2026-10-10" },
      ],
    });
    expect(news(watch)).toEqual(["price-differs"]);
  });

  it("treats equal amounts in different currencies as different prices", () => {
    const watch = watchWith({
      price: { amount: 485, currency: "CAD" },
      links: [{ url: "https://shop.example/w", price: { amount: 485, currency: "USD" }, condition: "new", observedAt: "2026-10-10" }],
    });
    expect(news(watch)).toContain("price-differs");
  });

  it("ignores exchange-rate drift between a converted tracked price and a foreign link", () => {
    const watch = watchWith({
      price: { amount: 3324, currency: "USD" },
      links: [{ url: "https://shop.example/w", price: { amount: 2525, currency: "GBP" }, condition: "new", observedAt: "2026-10-10" }],
    });
    expect(news(watch)).toEqual([]);
  });

  it("keeps the row when the offer is no longer fresh", () => {
    const watch = watchWith({
      links: [{ url: "https://shop.example/w", price: { amount: 599, currency: "USD" }, condition: "new", observedAt: "2026-08-01" }],
    });
    expect(news(watch)).toEqual(["not-fresh"]);
  });

  it("keeps the row for a pre-owned or unrecorded condition", () => {
    const preOwned = watchWith({
      links: [{ url: "https://shop.example/w", price: { amount: 599, currency: "USD" }, condition: "pre-owned", observedAt: "2026-10-10" }],
    });
    expect(news(preOwned)).toContain("condition");
    const unknown = watchWith({
      links: [{ url: "https://shop.example/w", price: { amount: 599, currency: "USD" }, observedAt: "2026-10-10" }],
    });
    expect(news(unknown)).toContain("condition");
  });

  it("flags an offer at target only when the tracked price isn't already there", () => {
    const watch = watchWith({ targetPrice: { amount: 600, currency: "USD" } });
    expect(news(watch, false)).toEqual(["at-target"]);
    expect(news(watch, true)).toEqual([]);
  });

  it("says nothing when there is no dated offer", () => {
    expect(news(watchWith({ links: [] }))).toEqual([]);
  });
});
