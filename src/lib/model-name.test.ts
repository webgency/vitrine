import { describe, expect, it } from "vitest";
import { cleanModelName } from "./model-name";

// Real scraped titles from the collection, 2026-10-11.
describe("cleanModelName", () => {
  it.each([
    ["GMT-Master II watch - m126710blnr-0002", { brand: "Rolex", referenceNumber: "126710BLNR", caseDiameterMm: 40 }, "GMT-Master II"],
    // Rolex's newer title form, 2026-10-25.
    ["Rolex GMT-Master II watch: Oystersteel - m126720vtnr-0001", { brand: "Rolex", referenceNumber: "126720VTNR", caseDiameterMm: 40, caseMaterial: "Oystersteel" }, "GMT-Master II"],
    ["Retrograph - Espresso Chronograph Watch", { brand: "Brew Watches", referenceNumber: "RG-RTRO", caseDiameterMm: 38 }, "Retrograph - Espresso Chronograph"],
    ["Argo Bronze 200M Automatic Diver Watch PY057B Spiral Sunray Blue", { brand: "Phoibos", referenceNumber: "PY057B", caseDiameterMm: 40.5 }, "Argo Bronze 200M Automatic Diver Spiral Sunray Blue"],
    ["Nereide Corallo - 4521546", { brand: "Venezianico", referenceNumber: "4521546", caseDiameterMm: 42 }, "Nereide Corallo"],
    ["Nereide GMT 39 - 3521511S", { brand: "Venezianico", referenceNumber: "3521511S", caseDiameterMm: 39 }, "Nereide GMT 39"],
    ["Hermétique Tourer Bronze Green- Baltic Watches", { brand: "Baltic", caseDiameterMm: 37 }, "Hermétique Tourer Bronze Green"],
    ["TISSOT GENTLEMAN 38MM", { brand: "Tissot", caseDiameterMm: 38 }, "Gentleman"],
    ["LAVENTURE TRANSATLANTIQUE II GMT STEEL / BLACK", { brand: "Laventure Watches", caseDiameterMm: 38.9 }, "Transatlantique II GMT Steel / Black"],
    ["Nevada Pine - 40mm", { brand: "Farer", referenceNumber: "W-NEV-40-ASV", caseDiameterMm: 40 }, "Nevada Pine"],
    ["Rhizome / HELIOS 39mm", { brand: "Humism", referenceNumber: "WA-RHZ-YLW", caseDiameterMm: 39 }, "Rhizome / Helios"],
    ["SOMBRERO 90-011", { brand: "Kuoe Kyoto", referenceNumber: "sm90011-gnv", caseDiameterMm: 38 }, "Sombrero 90-011"],
    ["Jurassic Watch RAPTORS Edition", { brand: "Sơn Mài – Silver Leaf", referenceNumber: "SMRA25AW" }, "Jurassic Watch Raptors Edition"],
  ])("cleans %s", (model, context, expected) => {
    expect(cleanModelName(model, context)).toBe(expected);
  });

  it.each([
    // "Watch" is part of the name here, not filler.
    ["Valiant — The Red Watch", { brand: "William Wood", caseDiameterMm: 41 }],
    // The tail is part of the name, not the reference.
    ["Sceptre S2 - Reactor", { brand: "Marloe Watch Company", referenceNumber: "S2REAC001", caseDiameterMm: 42 }],
    // A size that isn't trailing, or isn't the recorded diameter, stays.
    ["Thresher 44mm 'Azure'", { brand: "Zelos Watches", caseDiameterMm: 44 }],
    ["D5 Meridian Navy Auto - 39mm USA", { brand: "Vaer Watches", caseDiameterMm: 39 }],
    ["Club Campus 36mm", { brand: "NOMOS Glashütte", caseDiameterMm: 38.5 }],
    // A material that isn't the recorded case material stays.
    ["Datejust watch: Everose Rolesor", { brand: "Rolex", caseMaterial: "Oystersteel" }],
  ])("leaves %s alone", (model, context) => {
    expect(cleanModelName(model, context)).toBe(model);
  });

  it.each([
    ["1A SCR II — Blue"],
    ["MAXIGRAPH Albishorn x Massena LAB", "Maxigraph Albishorn x Massena LAB"],
    ["White Lollipop Manual INTER.BEZEL"],
    ["HUDSON 38 MK5", "Hudson 38 MK5"],
    ["MARINE GCC", "Marine GCC"],
    ["Royal Oak XVIII"],
  ])("title-cases only shouted words in %s", (model, expected = model) => {
    expect(cleanModelName(model)).toBe(expected);
  });

  it("never proposes an empty name or one that is only the reference", () => {
    expect(cleanModelName("ATC-40SVJRBL", { brand: "Knot", referenceNumber: "atc-40svjrbl" })).toBe("ATC-40SVJRBL");
    expect(cleanModelName("Tissot", { brand: "Tissot" })).toBe("Tissot");
  });
});
