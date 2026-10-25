import { describe, expect, it } from "vitest";
import { mergeRefreshed } from "./refresh-merge.mjs";

type W = { id: string; price: number; note?: string };
const map = (watches: W[]) => new Map(watches.map((w) => [w.id, structuredClone(w)]));

describe("mergeRefreshed", () => {
  const read: W[] = [{ id: "a", price: 100 }, { id: "b", price: 200 }];

  it("takes the refreshed watch when nobody touched it during the run", () => {
    const { watches, skipped } = mergeRefreshed(read, map(read), [{ id: "a", price: 90 }, { id: "b", price: 200 }]);
    expect(watches).toEqual([{ id: "a", price: 90 }, { id: "b", price: 200 }]);
    expect(skipped).toEqual([]);
  });

  it("keeps an edit made during the run and reports the dropped refresh", () => {
    const current = [{ id: "a", price: 100, note: "edited on the phone" }, { id: "b", price: 200 }];
    const { watches, skipped } = mergeRefreshed(current, map(read), [{ id: "a", price: 90 }, { id: "b", price: 210 }]);
    expect(watches).toEqual([{ id: "a", price: 100, note: "edited on the phone" }, { id: "b", price: 210 }]);
    expect(skipped).toEqual(["a"]);
  });

  it("does not report an edited watch the run left alone", () => {
    const current = [{ id: "a", price: 100, note: "edited" }, { id: "b", price: 200 }];
    expect(mergeRefreshed(current, map(read), read).skipped).toEqual([]);
  });

  it("keeps watches added and drops watches deleted during the run", () => {
    const current = [{ id: "b", price: 200 }, { id: "c", price: 300 }];
    const { watches } = mergeRefreshed(current, map(read), [{ id: "a", price: 90 }, { id: "b", price: 210 }]);
    expect(watches).toEqual([{ id: "b", price: 210 }, { id: "c", price: 300 }]);
  });
});
