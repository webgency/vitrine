import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Watch } from "./types";
import { finalistBlocker, finalists, MAX_FINALISTS } from "./finalists";

function watch(id: string, overrides: Partial<Watch> = {}): Watch {
  return { id, brand: "B", model: id, status: "wishlist", links: [], specs: {}, tags: [], dateAdded: "2026-01-01", ...overrides };
}

describe("finalists", () => {
  it("allows a wishlist watch until the cap, counting only real finalists", () => {
    const pinned = Array.from({ length: MAX_FINALISTS - 1 }, (_, i) => watch(`f${i}`, { finalist: true }));
    const stale = watch("owned", { status: "owned", finalist: true });
    expect(finalists([...pinned, stale])).toHaveLength(MAX_FINALISTS - 1);
    expect(finalistBlocker(watch("new"), [...pinned, stale])).toBeUndefined();
  });

  it("refuses a pin beyond the cap, but re-pinning a current finalist is fine", () => {
    const pinned = Array.from({ length: MAX_FINALISTS }, (_, i) => watch(`f${i}`, { finalist: true }));
    expect(finalistBlocker(watch("new"), pinned)).toMatch(/already have 5 finalists/);
    expect(finalistBlocker(pinned[0], pinned)).toBeUndefined();
  });

  it("refuses owned watches and ones marked Pass", () => {
    expect(finalistBlocker(watch("o", { status: "owned" }), [])).toMatch(/Only wishlist/);
    expect(finalistBlocker(watch("p", { wishlistTier: "pass" }), [])).toMatch(/marked Pass/);
  });

  it("matches the cap the bare-Node data validator enforces", () => {
    const script = readFileSync("scripts/validate-data.mjs", "utf8");
    expect(script).toContain(`const MAX_FINALISTS = ${MAX_FINALISTS};`);
  });
});
