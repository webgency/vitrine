import { describe, expect, it } from "vitest";
import { findPrivateLeaks, privateStrings } from "./check-export.mjs";

const records = { w1: { purchase: { price: { amount: 850, currency: "USD" }, date: "2025-06-01", source: "Tissot boutique" } } };

describe("check-export", () => {
  it("passes a page with no private data", () => {
    const page = { path: "out/index.html", text: '<p>Your purchase price does not fill this gap.</p>{"sale":{"price":850}}' };
    expect(findPrivateLeaks([page], records)).toEqual([]);
  });

  it("catches a private key, plain or inside an RSC string", () => {
    const plain = { path: "a.json", text: '{"purchase":{"price":{"amount":850}}}' };
    const escaped = { path: "b.html", text: 'self.__next_f.push([1,"{\\"purchase\\":{}}"])' };
    expect(findPrivateLeaks([plain, escaped])).toHaveLength(2);
  });

  it("catches a stored text value under another name", () => {
    const page = { path: "c.html", text: "<span>Tissot boutique</span>" };
    expect(findPrivateLeaks([page], records)).toEqual(["c.html: contains a value from data/private.json"]);
  });

  it("does not search for currency codes, dates or amounts", () => {
    expect(privateStrings(records)).toEqual(["Tissot boutique"]);
  });
});
