import { describe, expect, it } from "vitest";
import {
  MAX_ALERT_EVENTS,
  alertStateErrors,
  alertSummary,
  appendAlerts,
  detectAlerts,
  emptyAlertState,
  markAlertsRead,
  setAlertTypeEnabled,
  setWatchMuted,
  visibleAlerts,
  type AlertCandidate,
  type AlertEvent,
} from "./alerts.mjs";
import type { Money, RetailerLink, Watch } from "./types";

const NOW = new Date("2026-09-13T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const usd = (amount: number): Money => ({ amount, currency: "USD" });
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * HOUR).toISOString();
const URL = "https://shop.example/bb58";

function watch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    brand: "Tudor",
    model: "Black Bay 58",
    status: "wishlist",
    wishlistTier: "shortlist",
    price: usd(5250),
    priceUpdatedAt: daysAgo(40),
    links: [],
    specs: {},
    tags: [],
    dateAdded: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function link(overrides: Partial<RetailerLink> = {}): RetailerLink {
  return { url: URL, retailer: "Shop", condition: "new", price: usd(5250), observedAt: daysAgo(2), ...overrides };
}

const ofType = (candidates: AlertCandidate[], type: string) => candidates.filter((c) => c.type === type);

describe("target_met", () => {
  const target = usd(5000);

  it("fires when a dated ask moves to the target, citing source and date", () => {
    const before = watch({ targetPrice: target, links: [link({ price: usd(5200) })] });
    const after = watch({ targetPrice: target, links: [link({ price: usd(4950), observedAt: daysAgo(0) })] });
    const [alert] = ofType(detectAlerts(before, after, { now: NOW }), "target_met");
    expect(alert.payload).toMatchObject({
      watch: "Tudor Black Bay 58",
      price: usd(4950),
      basis: "listed",
      target,
      source: "Shop",
      url: URL,
      asOf: daysAgo(0),
    });
  });

  it("does not fire when the collector sets or changes the target", () => {
    const before = watch({ targetPrice: usd(4000), links: [link({ price: usd(4950) })] });
    const after = watch({ targetPrice: target, links: [link({ price: usd(4950) })] });
    expect(ofType(detectAlerts(before, after, { now: NOW }), "target_met")).toHaveLength(0);
  });

  it("does not repeat for a target already met at that price, but fires when it improves", () => {
    const met = watch({ targetPrice: target, links: [link({ price: usd(4950) })] });
    const reconfirmed = watch({ targetPrice: target, links: [link({ price: usd(4950), observedAt: daysAgo(0) })] });
    const better = watch({ targetPrice: target, links: [link({ price: usd(4800), observedAt: daysAgo(0) })] });
    expect(ofType(detectAlerts(met, reconfirmed, { now: NOW }), "target_met")).toHaveLength(0);
    expect(ofType(detectAlerts(met, better, { now: NOW }), "target_met")).toHaveLength(1);
  });
});

describe("price_drop", () => {
  const trail = (...points: [number, number][]) => points.map(([amount, days]) => ({ price: usd(amount), date: daysAgo(days) }));
  const withTrail = (points: [number, number][]) => {
    const history = trail(...points);
    return link({ price: history[history.length - 1].price, askHistory: history });
  };

  it("fires at 5% or more below the highest ask since first recorded", () => {
    const before = watch({ links: [withTrail([[5400, 20], [5250, 10]])] });
    const after = watch({ links: [withTrail([[5400, 20], [5250, 10], [4950, 0]])] });
    const [alert] = ofType(detectAlerts(before, after, { now: NOW }), "price_drop");
    expect(alert.payload).toMatchObject({ price: usd(4950), previousPrice: usd(5400), previousAsOf: daysAgo(20), url: URL });
    expect(alert.payload.dropPct).toBeCloseTo(450 / 5400, 3);
  });

  it("stays quiet under the threshold", () => {
    const before = watch({ links: [withTrail([[5250, 10], [5200, 5]])] });
    const after = watch({ links: [withTrail([[5250, 10], [5200, 5], [5100, 0]])] });
    expect(ofType(detectAlerts(before, after, { now: NOW }), "price_drop")).toHaveLength(0);
  });

  it("measures from the last drop alert, so an old drop isn't counted twice", () => {
    const events = [
      { id: "a", watchId: "w1", type: "price_drop", createdAt: daysAgo(10), payload: { watch: "x", price: usd(4950), priceUsd: 4950, asOf: daysAgo(10), url: URL } },
    ] as AlertEvent[];
    const before = watch({ links: [withTrail([[5400, 20], [4950, 10]])] });
    const small = watch({ links: [withTrail([[5400, 20], [4950, 10], [4800, 0]])] });
    const large = watch({ links: [withTrail([[5400, 20], [4950, 10], [4650, 0]])] });
    expect(ofType(detectAlerts(before, small, { now: NOW, events }), "price_drop")).toHaveLength(0);
    expect(ofType(detectAlerts(before, large, { now: NOW, events }), "price_drop")).toHaveLength(1);
  });

  it("only fires for a move recorded by this write", () => {
    const same = watch({ links: [withTrail([[5400, 20], [4950, 10]])] });
    expect(ofType(detectAlerts(same, same, { now: NOW }), "price_drop")).toHaveLength(0);
  });
});

describe("fresh_offer", () => {
  it("fires for a new dated ask on a watch you are watching or have shortlisted", () => {
    const before = watch({ links: [link({ price: undefined, observedAt: undefined })] });
    const after = watch({ links: [link({ observedAt: daysAgo(0) })] });
    const [alert] = ofType(detectAlerts(before, after, { now: NOW }), "fresh_offer");
    expect(alert.payload).toMatchObject({ kind: "new", price: usd(5250), source: "Shop" });
  });

  it("fires when a stale ask is confirmed again, not when an aging one is", () => {
    const after = watch({ links: [link({ observedAt: daysAgo(0) })] });
    const stale = watch({ links: [link({ observedAt: daysAgo(40) })] });
    const aging = watch({ links: [link({ observedAt: daysAgo(12) })] });
    expect(ofType(detectAlerts(stale, after, { now: NOW }), "fresh_offer")[0]?.payload.kind).toBe("back");
    expect(ofType(detectAlerts(aging, after, { now: NOW }), "fresh_offer")).toHaveLength(0);
  });

  it("skips Pass and owned watches", () => {
    const before = (o: Partial<Watch>) => watch({ ...o, links: [link({ observedAt: daysAgo(40) })] });
    const after = (o: Partial<Watch>) => watch({ ...o, links: [link({ observedAt: daysAgo(0) })] });
    for (const overrides of [{ wishlistTier: "pass" }, { status: "owned", wishlistTier: undefined }] as Partial<Watch>[]) {
      expect(ofType(detectAlerts(before(overrides), after(overrides), { now: NOW }), "fresh_offer")).toHaveLength(0);
    }
  });

  describe("discount against the tracked price", () => {
    const DEALER = "https://dealer.example/bb58";
    const fresh = (price: Money, condition: RetailerLink["condition"] = "new") =>
      ofType(
        detectAlerts(watch(), watch({ links: [link({ url: DEALER, retailer: "Dealer", price, condition, observedAt: daysAgo(0) })] }), { now: NOW }),
        "fresh_offer"
      )[0]?.payload;

    it("marks a new-condition ask 10% or more under the tracked price", () => {
      expect(fresh(usd(4462.5))).toMatchObject({ belowTrackedPct: 0.15, trackedPrice: usd(5250) });
      expect(fresh(usd(4725))).toMatchObject({ belowTrackedPct: 0.1 });
    });

    it("leaves a smaller gap unmarked", () => {
      expect(fresh(usd(4800))).not.toHaveProperty("belowTrackedPct");
    });

    it("never marks a pre-owned ask, which sits under a new price as a matter of course", () => {
      expect(fresh(usd(3000), "pre-owned")).not.toHaveProperty("belowTrackedPct");
    });

    it("measures from the tracked price before the write, even if a refresh moved it to the same ask", () => {
      const before = watch({ links: [link({ observedAt: daysAgo(40) })] });
      const after = watch({ price: usd(4462.5), links: [link({ price: usd(4462.5), observedAt: daysAgo(0) })] });
      const [alert] = ofType(detectAlerts(before, after, { now: NOW }), "fresh_offer");
      expect(alert.payload).toMatchObject({ kind: "back", belowTrackedPct: 0.15, trackedPrice: usd(5250) });
    });
  });
});

it("never fires for a newly added watch", () => {
  const added = watch({ targetPrice: usd(6000), links: [link({ observedAt: daysAgo(0) })] });
  expect(detectAlerts(undefined, added, { now: NOW })).toEqual([]);
});

describe("appendAlerts", () => {
  const candidate = (priceUsd: number, type: AlertCandidate["type"] = "price_drop"): AlertCandidate => ({
    type,
    watchId: "w1",
    payload: { watch: "Tudor Black Bay 58", price: usd(priceUsd), priceUsd, asOf: daysAgo(0) },
  });

  it("records one per watch and type per 24 hours unless the price improves", () => {
    let { state, added } = appendAlerts(emptyAlertState(), [candidate(4950)], NOW);
    expect(added[0]).toMatchObject({ watchId: "w1", type: "price_drop", createdAt: NOW.toISOString() });

    const soon = new Date(NOW.getTime() + 2 * HOUR);
    expect(appendAlerts(state, [candidate(4950)], soon).added).toHaveLength(0);
    expect(appendAlerts(state, [candidate(5000)], soon).added).toHaveLength(0);
    ({ state, added } = appendAlerts(state, [candidate(4800)], soon));
    expect(added).toHaveLength(1);

    const nextDay = new Date(soon.getTime() + 25 * HOUR);
    expect(appendAlerts(state, [candidate(4800)], nextDay).added).toHaveLength(1);
  });

  it("dedupes each type separately", () => {
    const { state } = appendAlerts(emptyAlertState(), [candidate(4950)], NOW);
    expect(appendAlerts(state, [candidate(4950, "fresh_offer")], NOW).added).toHaveLength(1);
  });

  it("records nothing for a muted watch or a switched-off type", () => {
    expect(appendAlerts(setWatchMuted(emptyAlertState(), "w1", true), [candidate(4950)], NOW).added).toHaveLength(0);
    expect(appendAlerts(setAlertTypeEnabled(emptyAlertState(), "price_drop", false), [candidate(4950)], NOW).added).toHaveLength(0);
  });

  it("keeps only the newest events", () => {
    let state = emptyAlertState();
    for (let i = 0; i < MAX_ALERT_EVENTS + 5; i++) {
      state = appendAlerts(state, [{ ...candidate(4950), watchId: `w${i}` }], NOW).state;
    }
    expect(state.events).toHaveLength(MAX_ALERT_EVENTS);
    expect(state.events[state.events.length - 1].watchId).toBe(`w${MAX_ALERT_EVENTS + 4}`);
  });
});

describe("alert state", () => {
  const seeded = () => {
    let state = emptyAlertState();
    for (const [watchId, type, hours] of [["w1", "price_drop", 0], ["w2", "target_met", 1], ["w3", "fresh_offer", 2]] as const) {
      state = appendAlerts(
        state,
        [{ type, watchId, payload: { watch: watchId, price: usd(100), priceUsd: 100, asOf: daysAgo(0) } }],
        new Date(NOW.getTime() + hours * HOUR)
      ).state;
    }
    return state;
  };

  it("shows newest first, without muted watches or switched-off types", () => {
    const state = setAlertTypeEnabled(setWatchMuted(seeded(), "w1", true), "fresh_offer", false);
    expect(visibleAlerts(state).map((e) => e.watchId)).toEqual(["w2"]);
    expect(visibleAlerts(seeded()).map((e) => e.watchId)).toEqual(["w3", "w2", "w1"]);
  });

  it("counts unread and marks read", () => {
    const state = seeded();
    expect(alertSummary(state)).toEqual({ total: 3, unread: 3 });
    const one = markAlertsRead(state, [state.events[0].id]);
    expect(alertSummary(one)).toEqual({ total: 3, unread: 2 });
    expect(alertSummary(markAlertsRead(state))).toEqual({ total: 3, unread: 0 });
  });

  it("validates the file shape", () => {
    expect(alertStateErrors(seeded())).toEqual([]);
    expect(alertStateErrors({ version: 1, events: [] })).toEqual([]);
    const errors = alertStateErrors({
      version: 2,
      settings: { types: { price_drop: "yes", sold: true } },
      events: [{ id: "x", watchId: "w1", type: "sold", createdAt: "nope", payload: { watch: "w", price: usd(1) } }],
    });
    expect(errors.join(" ")).toContain("alerts.version must be 1");
    expect(errors.join(" ")).toContain("alerts.settings.types.sold is not an alert type");
    expect(errors.join(" ")).toContain("alerts.settings.types.price_drop must be true or false");
    expect(errors.join(" ")).toContain("alerts.events[0].type");
    expect(errors.join(" ")).toContain("alerts.events[0].payload.asOf");
  });
});
