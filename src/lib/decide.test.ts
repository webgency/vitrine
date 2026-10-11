import { describe, expect, it } from "vitest";
import type { Watch } from "./types";
import { standingSummaries } from "./scoring";
import { decideColumns } from "./decide";

const NOW = new Date("2026-10-11T12:00:00Z");

function watch(id: string, overrides: Partial<Watch> = {}): Watch {
  return {
    id,
    brand: "Test",
    model: id,
    status: "wishlist",
    scoringCategory: "diver",
    price: { amount: 800, currency: "USD" },
    links: [{ url: `https://a.example/${id}`, price: { amount: 800, currency: "USD" }, condition: "new", observedAt: "2026-10-10" }],
    specs: { caseDiameterMm: 40, waterResistanceM: 200, caliber: "Miyota 9039", movement: "automatic" },
    tags: [],
    dateAdded: "2026-01-01",
    ...overrides,
  };
}

function columns(watches: Watch[]) {
  return decideColumns(watches, standingSummaries(watches, watches), NOW);
}

describe("decideColumns", () => {
  it("shows only finalists, cheapest first", () => {
    const result = columns([
      watch("a", { finalist: true, price: { amount: 1200, currency: "USD" } }),
      watch("b"),
      watch("c", { finalist: true, price: { amount: 600, currency: "USD" } }),
    ]);
    expect(result.map((column) => column.watch.id)).toEqual(["c", "a"]);
  });

  it("lists the inputs that would change the picture, each with where to add it", () => {
    const [column] = columns([watch("a", { finalist: true })]);
    expect(column.todos.map((todo) => todo.key)).toEqual(["second-seller", "target", "unrated", "design"]);
    expect(column.todos[0]).toMatchObject({ text: "Add another seller's price (1 of 2)", href: "/watch/a#market" });
  });

  it("drops a to-do once its input exists, and shows the deal once two sellers do", () => {
    const [column] = columns([
      watch("a", {
        finalist: true,
        targetPrice: { amount: 750, currency: "USD" },
        designUniqueness: 4,
        links: [
          { url: "https://a.example/a", price: { amount: 800, currency: "USD" }, condition: "new", observedAt: "2026-10-10" },
          { url: "https://b.example/a", price: { amount: 900, currency: "USD" }, condition: "new", observedAt: "2026-10-10" },
        ],
      }),
    ]);
    const keys = column.todos.map((todo) => todo.key);
    expect(keys).not.toContain("second-seller");
    expect(keys).not.toContain("target");
    expect(keys).not.toContain("design");
    expect(column.deal).toBeDefined();
    expect(column.targetGapUsd).toBe(50);
  });

  it("keeps each axis separate and leaves a missing one missing", () => {
    const [column] = columns([watch("a", { finalist: true })]);
    expect(column.design).toBeUndefined();
    expect(column.quadrant).toBeNull();
    expect(Object.keys(column)).not.toContain("score");
  });
});
