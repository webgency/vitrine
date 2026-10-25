import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractSpecs,
  extractQualityFlags,
  isShopifyCollectionUrl,
  labeledBrand,
  plainText,
  primaryProductText,
  productExtractionText,
  resolveBrand,
  scrapeWatch,
  selectShopifyVariant,
  shopifyProductJsonUrl,
  specCoverage,
  strapFromVariant,
  strongSpecSignals,
  variantNamesStrap,
} from "./scrape";

const nomosPage = readFileSync(new URL("./fixtures/nomos-club-campus.html", import.meta.url), "utf8");
const viisPage = readFileSync(new URL("./fixtures/viis-flieger-gmt-42-de.html", import.meta.url), "utf8");
const henryArcherPage = readFileSync(new URL("./fixtures/henry-archer-tidevand-kosmos.html", import.meta.url), "utf8");
const av86Page = readFileSync(new URL("./fixtures/av86-1564-chronodate-steel-white.html", import.meta.url), "utf8");
const malouinePage = readFileSync(new URL("./fixtures/le-forban-malouine.html", import.meta.url), "utf8");
const breitlingPage = readFileSync(new URL("./fixtures/breitling-top-time-deus.html", import.meta.url), "utf8");
const rolexPage = readFileSync(new URL("./fixtures/rolex-gmt-master-ii-126720vtnr.html", import.meta.url), "utf8");
const tissotPage = readFileSync(new URL("./fixtures/tissot-le-locle-t0064073603300.html", import.meta.url), "utf8");
// Viis's real Shopify body_html: marketing only, with no calibre or dimensions table.
const VIIS_BODY_HTML =
  "<p>The Flieger GMT 42 Adriatic is like the sea: deep blue, clear and full of vastness. It masterfully combines " +
  "traditional craftsmanship with modern elegance. Inspired by the glistening waters along&nbsp;the Croatian coast, " +
  "the versatile automatic watch symbolises freedom and connection to nature. With a case diameter of 42 mm, it is " +
  "perfect for daily wear&nbsp;and stands out with its GMT function.</p>";

const SPINNAKER_STYLE_PAGE = `
  <header>
    Related: 39mm quartz chronograph GMT
  </header>
  <main id="MainContent">
    <section class="size-guide">Find Your Case Diameter 39mm 40-42mm 43-45mm</section>
    <h1>Croft Mid-Size Automatic - Dolphin Project Limited Edition</h1>
    <section>
      <h2>Specification</h2>
      Movement: Japanese Automatic With 3 Hands Date
      Case Material: Stainless Steel
      Case Size (mm): 40.0
      Case Thickness (mm): 14.1
      Lug to Lug (mm): 47.0
      Dial Colour: Green
      Lens: Anti Reflection Coated Sapphire Lens
      Band: 20mm Stainless Steel With Fold Over Buckle
      Extra Band: Grey RPET Strap
      Water Resistance: 15 ATM
      Instruction Manual
      <h3>Miyota 8215 Automatic Movement</h3>
      42 Hours Power Reserve
      Designed for the avid diver and adventurer.
    </section>
    <section><h2>FAQs</h2>Other watches use quartz and GMT movements.</section>
  </main>
  <footer>Chronograph collection</footer>
`;

describe("primaryProductText", () => {
  it("isolates the specification area from navigation, size guides, related products, and FAQs", () => {
    const text = primaryProductText(SPINNAKER_STYLE_PAGE);

    expect(text).toContain("Case Size (mm): 40.0");
    expect(text).toContain("Miyota 8215 Automatic Movement");
    expect(text).not.toContain("Find Your Case Diameter");
    expect(text).not.toContain("Other watches use quartz");
    expect(text).not.toContain("Chronograph collection");
  });
});

describe("productExtractionText", () => {
  it("does not mix a Shopify product description with unrelated rendered-page specs", () => {
    const body = "D5 Pacific. 39mm automatic movement. 20 ATM water resistance.";
    const renderedPage = `<main>${body}<section>Related: 36mm quartz chronograph GMT</section></main>`;

    const text = productExtractionText(body, renderedPage);

    expect(text).toContain("39mm automatic");
    expect(text).not.toContain("36mm quartz chronograph GMT");
  });

  it("prefers a bounded technical section over a sparse Shopify description", () => {
    const body = "A handsome automatic watch.";
    const renderedPage = `
      <main>
        Size guide: 36mm quartz chronograph GMT
        <section>Technical Details — Japan Miyota 9015 — 42 hour power reserve — 20 ATM</section>
        <section>Customers Also Love: 44mm solar GMT</section>
      </main>`;

    const text = productExtractionText(body, renderedPage);

    expect(text).toContain("Miyota 9015");
    expect(text).not.toContain("36mm quartz chronograph GMT");
    expect(text).not.toContain("44mm solar GMT");
  });

  it("allows a collection page only when it has a bounded specification section", () => {
    const withSpecs = `<main>Other model: GMT Specifications DIAMETER 38mm MOVEMENT La Joux Perret G100 Our Collections GMT</main>`;
    const withoutSpecs = `<main>Product one: quartz. Product two: automatic GMT.</main>`;

    expect(productExtractionText(undefined, withSpecs, true)).toBe("Specifications DIAMETER 38mm MOVEMENT La Joux Perret G100");
    expect(productExtractionText(undefined, withoutSpecs, true)).toBe("");
  });
});

describe("selectShopifyVariant", () => {
  const variants = [
    { id: 100, available: true, sku: "FIRST", price: "749.00" },
    { id: 200, available: true, sku: "REQUESTED", price: "839.00" },
  ];

  it("honors the variant in the product URL", () => {
    expect(selectShopifyVariant("https://example.com/products/watch?variant=200", variants)?.sku).toBe("REQUESTED");
  });

  it("falls back to the first available variant", () => {
    expect(selectShopifyVariant("https://example.com/products/watch", variants)?.sku).toBe("FIRST");
  });
});

describe("Shopify URL classification", () => {
  it("supports localized product paths", () => {
    expect(shopifyProductJsonUrl("https://example.com/en-us/products/hudson?variant=200"))
      .toBe("https://example.com/en-us/products/hudson.json");
  });

  it("distinguishes collection landing pages from product URLs", () => {
    expect(isShopifyCollectionUrl("https://example.com/en-us/collections/hudson-38-mk5")).toBe(true);
    expect(isShopifyCollectionUrl("https://example.com/collections/divers/products/hudson")).toBe(false);
  });
});

describe("extractSpecs", () => {
  it("reads labeled Shopify specs without taking nearby values from other fields", () => {
    const specs = extractSpecs(primaryProductText(SPINNAKER_STYLE_PAGE));

    expect(specs).toMatchObject({
      caseDiameterMm: 40,
      caseThicknessMm: 14.1,
      lugToLugMm: 47,
      lugWidthMm: 20,
      caseMaterial: "Stainless Steel",
      movement: "automatic",
      caliber: "Miyota 8215",
      powerReserveHours: 42,
      waterResistanceM: 150,
      crystal: "Sapphire",
      dialColor: "Green",
      braceletStrap: "20mm Stainless Steel With Fold Over Buckle",
    });
    expect(specs.complications).toBeUndefined();
  });

  it("reads standalone caliber names and written-out reserve units", () => {
    expect(extractSpecs("Automatic — Japan Miyota 9015 — 42 hour power reserve")).toMatchObject({
      movement: "automatic",
      caliber: "Miyota 9015",
      powerReserveHours: 42,
    });
    expect(extractSpecs("MOVEMENT La Joux Perret G100 Automatic POWER RESERVE ~68 hours")).toMatchObject({
      movement: "automatic",
      caliber: "La Joux Perret G100",
      powerReserveHours: 68,
    });
    expect(extractSpecs("Depth 12.5mm. The case measures 11.9mm in height and 46mm from lug to lug.")).toMatchObject({
      caseThicknessMm: 12.5,
      lugToLugMm: 46,
    });
  });

  it("prefers an explicit maker and caliber over nearby calibre prose", () => {
    expect(extractSpecs("Sellita SW330-2 automatic movement. This dependable calibre beats at a smooth rate of 28,800 bph.").caliber)
      .toBe("Sellita SW330-2");
  });
});

describe("extractQualityFlags", () => {
  it("captures explicit scoring evidence without guessing absent features", () => {
    expect(extractQualityFlags(
      "Adjusted for accuracy in 5 positions. Sapphire bezel insert. Lug holes. " +
      "Internal anti-reflective coating. Quick-release end links and on-the-fly micro-adjust. +/-5 spd.",
      "7-Link Bracelet"
    )).toEqual({
      regulatedPositions: 5,
      accuracySpecSpd: 5,
      sapphireBezelInsert: true,
      drilledLugs: true,
      arCoated: true,
      microAdjustClasp: true,
      quickRelease: true,
      braceletIncluded: true,
    });
  });

  it("marks an explicitly selected strap as no bracelet", () => {
    expect(extractQualityFlags("Sapphire crystal", "FKM Dive Strap")).toEqual({ braceletIncluded: false });
  });

  it("recognizes a page that explicitly says the measured watch includes its bracelet", () => {
    expect(extractQualityFlags("Weight: 160g including bracelet")).toEqual({ braceletIncluded: true });
  });
});

describe("NOMOS definition-list specifications", () => {
  it("reaches the actual specs past navigation and FAQ links, retaining labeled values", () => {
    const text = productExtractionText(undefined, nomosPage);
    expect(text).not.toContain("coordinates with");
    expect(text).not.toContain("Other watch");
    expect(extractSpecs(text)).toMatchObject({
      caseDiameterMm: 36,
      caseThicknessMm: 8.2,
      lugToLugMm: 44.3,
      lugWidthMm: 18,
      caseMaterial: "stainless steel, screwed stainless steel back",
      crystal: "Sapphire",
      movement: "manual",
      dialColor: "dark blue",
      braceletStrap: "Vegan velour remborde velvet gray",
      caliber: "DUW 4001",
      powerReserveHours: 53,
      waterResistanceM: 100,
    });
    expect(extractSpecs(text).complications).toBeUndefined();
  });

  it("does not treat dial-color marketing prose as a labeled color", () => {
    expect(extractSpecs("This dial color coordinates with all other tones.").dialColor).toBeUndefined();
  });
});

describe("Viis Flieger GMT 42 Adriatic (German page, thin Shopify body)", () => {
  it("uses the SPEZIFIKATIONEN block instead of the marketing-only description", () => {
    const text = productExtractionText(VIIS_BODY_HTML, viisPage);
    expect(text).toContain("Miyota 9075");
    expect(text).not.toContain("9039");
    expect(text).not.toContain("Pilot 38");

    expect(extractSpecs(text)).toMatchObject({
      caseDiameterMm: 42,
      lugToLugMm: 49,
      // Including the crystal: the height brands usually quote.
      caseThicknessMm: 13.4,
      lugWidthMm: 20,
      caseMaterial: "316L Edelstahl",
      movement: "automatic",
      caliber: "Miyota 9075",
      powerReserveHours: 42,
      waterResistanceM: 100,
      crystal: "Sapphire",
      braceletStrap: "Kalbsleder",
      complications: "GMT",
    });
    // Quick-release is not stated on this page, so it is not claimed.
    expect(extractQualityFlags(text)).toEqual({ arCoated: true });
  });

  it("reads panel-only pages through the dense-label fallback, skipping an ex-crystal height", () => {
    const panelsOnly = viisPage.replace(/<section><ul>[\s\S]*?<\/ul><\/section>/, "");
    const text = productExtractionText(VIIS_BODY_HTML, panelsOnly);
    expect(text).not.toContain("9039");

    const specs = extractSpecs(text);
    expect(specs).toMatchObject({
      caseDiameterMm: 42,
      lugToLugMm: 49,
      lugWidthMm: 20,
      caseMaterial: "316L Edelstahl",
      movement: "automatic",
      caliber: "Miyota 9075",
      powerReserveHours: 42,
      waterResistanceM: 100,
      crystal: "Sapphire",
      braceletStrap: "Kalbsleder",
    });
    expect(specs.caseThicknessMm).toBeUndefined();
  });

  it("keeps a marketing description thin and a real spec panel dense", () => {
    expect(strongSpecSignals(VIIS_BODY_HTML)).toBe(0);
    expect(strongSpecSignals("Kaliber: Miyota 9075; Wasserdichtigkeit: 100 m; Abstand der Bandanstöße: 49 mm; Gehäusehöhe (inkl. Glas): 13,4 mm")).toBe(4);
  });
});

describe("locale-aware spec labels", () => {
  it("parses French, Spanish and Italian labels with comma decimals", () => {
    expect(extractSpecs(
      "Diamètre du boîtier : 40 mm; Épaisseur : 11,5 mm; Entre-cornes : 20 mm; Longueur corne à corne : 47 mm; " +
      "Étanchéité : 100 m; Calibre : Sellita SW200-1; Mouvement : automatique; Réserve de marche : 41 heures; Verre saphir"
    )).toMatchObject({
      caseDiameterMm: 40, caseThicknessMm: 11.5, lugWidthMm: 20, lugToLugMm: 47, waterResistanceM: 100,
      caliber: "Sellita SW200-1", movement: "automatic", powerReserveHours: 41, crystal: "Sapphire",
    });
    expect(extractSpecs(
      "Diámetro: 41 mm; Espesor: 12,2 mm; Distancia entre asas: 48 mm; Ancho de correa: 20 mm; " +
      "Resistencia al agua: 200 m; Movimiento: automático; Reserva de marcha: 70 horas; Cristal de zafiro"
    )).toMatchObject({
      caseDiameterMm: 41, caseThicknessMm: 12.2, lugToLugMm: 48, lugWidthMm: 20, waterResistanceM: 200,
      movement: "automatic", powerReserveHours: 70, crystal: "Sapphire",
    });
    expect(extractSpecs(
      "Diametro: 40 mm; Spessore: 12 mm; Larghezza anse: 20 mm; Impermeabilità: 300 m; " +
      "Calibro: Sellita SW300-1; Movimento: automatico; Riserva di carica: 56 ore; Vetro zaffiro"
    )).toMatchObject({
      caseDiameterMm: 40, caseThicknessMm: 12, lugWidthMm: 20, waterResistanceM: 300,
      caliber: "Sellita SW300-1", movement: "automatic", powerReserveHours: 56, crystal: "Sapphire",
    });
  });

  it("treats hand-winding as a capability of an automatic, not a manual movement", () => {
    expect(extractSpecs("Automatik, Handaufzug möglich").movement).toBe("automatic");
    expect(extractSpecs("Automatic with hand-winding and hacking").movement).toBe("automatic");
    expect(extractSpecs(
      "Type: Automatic winding; Calibre: Miyota 9075; Functions: date, second time zone, manual winding capability; Power reserve: 42 hours"
    )).toMatchObject({ movement: "automatic", caliber: "Miyota 9075", powerReserveHours: 42 });
    expect(extractSpecs("Movement: Hand-wound calibre DUW 4001").movement).toBe("manual");
  });

  it("reads values written before their labels without taking the next sentence's number", () => {
    // Henry Archer's wording; the diameter used to come back as 20.
    expect(extractSpecs("Specifications • Size; 40 mm diameter. 20 mm lug width. 47 mm lug-to-lug, 10,65 mm thickness.")).toMatchObject({
      caseDiameterMm: 40,
      lugWidthMm: 20,
      lugToLugMm: 47,
      caseThicknessMm: 10.65,
    });
  });

  it("never reads a buckle width or an ex-crystal height as a case spec", () => {
    expect(extractSpecs("Gehäusehöhe (exkl. Glas): 11,3 mm; Schließenbreite: 18 mm")).toEqual({});
    expect(extractSpecs("Case height (excluding crystal): 11.3 mm; Case height (including crystal): 13.4 mm").caseThicknessMm).toBe(13.4);
  });

  it("decodes accented entities before matching labels", () => {
    const html = "<main><p>Geh&auml;usedurchmesser: 39 mm</p><p>&Eacute;tanch&eacute;it&eacute; : 100 m</p></main>";
    expect(extractSpecs(productExtractionText(undefined, html))).toMatchObject({ caseDiameterMm: 39, waterResistanceM: 100 });
  });

  it("recognizes German and French quality evidence only when stated", () => {
    expect(extractQualityFlags("Saphirglas mit Antireflexbeschichtung; Schnellwechsel-Federstege")).toEqual({ arCoated: true, quickRelease: true });
    expect(extractQualityFlags("Verre saphir avec traitement anti-reflet")).toEqual({ arCoated: true });
    expect(extractQualityFlags("Saphirglas")).toEqual({});
  });
});

describe("Henry Archer Tidevand Meteorite (testimonials and other models below the specs)", () => {
  it("stops at Testimonials, so reviews and other models' panels add no specs or flags", () => {
    const text = productExtractionText(undefined, henryArcherPage);
    expect(text).not.toMatch(/Vesterhav|Verden|Dacnis|micro adjust|Trinity Grey EVO/i);

    const specs = extractSpecs(text);
    expect(specs).toMatchObject({
      caseDiameterMm: 40,
      lugWidthMm: 20,
      lugToLugMm: 47,
      caseThicknessMm: 10.65,
      caliber: "Miyota 9015",
      movement: "automatic",
      powerReserveHours: 42,
      waterResistanceM: 200,
      crystal: "Sapphire",
      braceletStrap: "316L stainless steel BoR (Beads-of-Rice) bracelet",
    });
    // The Tidevand has a ceramic bezel and no GMT; both came from below the specs.
    expect(specs.complications).toBeUndefined();
    expect(extractQualityFlags(text)).toEqual({ arLayers: 6 });
  });

  it("records a stated AR layer count instead of a plain coating flag", () => {
    expect(extractQualityFlags("6-layer AR coating.")).toEqual({ arLayers: 6 });
    expect(extractQualityFlags("Sapphire with 5 layers of anti-reflective coating")).toEqual({ arLayers: 5 });
    expect(extractQualityFlags("Internal AR coating (7 layers)")).toEqual({ arLayers: 7 });
    expect(extractQualityFlags("Saphirglas, 6-fach entspiegelt")).toEqual({ arLayers: 6 });
    expect(extractQualityFlags("Internal anti-reflective coating")).toEqual({ arCoated: true });
    expect(extractQualityFlags("A clear 3 layer lacquer; AR coating")).toEqual({ arCoated: true });
  });

  it("reads a bulleted strap heading without taking a bare width", () => {
    expect(extractSpecs("• Bracelet; 316L stainless steel BoR (Beads-of-Rice) bracelet. 20 mm width.").braceletStrap)
      .toBe("316L stainless steel BoR (Beads-of-Rice) bracelet");
    expect(extractSpecs("• Strap; 20 mm; quick release").braceletStrap).toBeUndefined();
  });
});

describe("Breitling Top Time Deus (each value in its own box after the label)", () => {
  it("pairs a label with the value box after it, but not a section title with the next label", () => {
    const text = productExtractionText(undefined, breitlingPage);
    expect(text).toContain("Diameter: 41 mm; Thickness: 14.27 mm; Lug width (in-between lug): 20 mm");
    expect(text).toContain("Strap; Strap material: Calfskin leather");
    expect(text).not.toMatch(/Strap: Strap material/);

    expect(extractSpecs(text)).toMatchObject({
      caseDiameterMm: 41,
      caseThicknessMm: 14.27,
      lugWidthMm: 20,
      powerReserveHours: 48,
      waterResistanceM: 30, // "3 bars (30 m /99 ft)"
      movement: "automatic",
      caliber: "Breitling 23",
      crystal: "Sapphire",
      caseMaterial: "Stainless steel",
      braceletStrap: "Calfskin leather",
    });
    // "Convex sapphire crystal, glareproofed both sides" is Breitling's AR wording.
    expect(extractQualityFlags(text)).toMatchObject({ arCoated: true });
  });

  it("never stores a strap row's label as the strap under a heading-style panel", () => {
    expect(extractSpecs("Strap; Strap material; Calfskin leather").braceletStrap).not.toBe("Strap material");
  });
});

describe("Rolex GMT-Master II (label and value as the two children of a list row)", () => {
  it("reads each <li><h5>label</h5><p>value</p></li> row and the case's bare Material row", () => {
    const text = productExtractionText(undefined, rolexPage);
    expect(text).toContain("Diameter: 40 mm; Material: Oystersteel");
    expect(extractSpecs(text)).toMatchObject({
      caseDiameterMm: 40,
      waterResistanceM: 100, // "Waterproof to 100 metres / 330 feet"
      caliber: "3285",
      caseMaterial: "Oystersteel",
      dialColor: "Black",
      braceletStrap: "Oyster, three-piece solid links",
      powerReserveHours: 70,
      movement: "automatic",
      crystal: "Sapphire",
    });
  });
});

describe("Tissot Le Locle (label and value as two divs in an indented row)", () => {
  it("pairs each row despite the indentation, so values stop at their own row", () => {
    const text = productExtractionText(undefined, tissotPage);
    expect(text).toContain("Case lug width (mm): 19.00; Case water resistance:");
    const specs = extractSpecs(text);
    expect(specs).toMatchObject({
      caseDiameterMm: 39.3,
      caseThicknessMm: 9.75,
      lugWidthMm: 19, // the unit is in the label: "(mm): 19.00"
      waterResistanceM: 30,
      caseMaterial: "316L stainless steel & PVD coating",
      dialColor: "Silver",
      braceletStrap: "Leather",
      caliber: "Powermatic 80", // named only in the feature copy
      powerReserveHours: 80,
    });
    // The site menu's "Chronograph" is outside the technical section.
    expect(specs.complications).toBeUndefined();
  });
});

describe("label/value rows that must not pair", () => {
  it("never reads a product card's price as its value", () => {
    const html = '<main><h2>Specifications</h2><div><span>White Leather Strap</span><span>$50.00</span></div></main>';
    expect(extractSpecs(productExtractionText(undefined, html)).braceletStrap).toBeUndefined();
  });

  it("never reads the tail of another label as the strap", () => {
    expect(extractSpecs("Case Weight: 70.87g; Weight inc. Strap: 178g; Strap Material: Bader bracelet").braceletStrap).toBe("Bader bracelet");
  });

  it("reads a bare Dial row only when it names a colour", () => {
    expect(extractSpecs("LUME; Hands: Swiss; Dial: Swiss; DIAL; Blue").dialColor).toBeUndefined();
    expect(extractSpecs("Dial: Black; Details: Chromalight").dialColor).toBe("Black");
  });
});

describe("AV86 1564 Chronodate (labelled rows grouped under a spec term)", () => {
  it("pairs each row's label with its own value, decimal comma included", () => {
    const text = productExtractionText(undefined, av86Page);
    expect(text).toContain("Size; Case diameter: 39 mm; Lug to lug: 49,2 mm; Case thickness: 13 mm; Lug width: 20 mm");
    expect(text).not.toMatch(/Dial color: Dial color/);

    const specs = extractSpecs(text);
    expect(specs).toMatchObject({
      caseDiameterMm: 39,
      lugToLugMm: 49.2,
      caseThicknessMm: 13,
      lugWidthMm: 20,
      dialColor: "White",
      caseMaterial: "316L high precision stainless steel",
      caliber: "Miyota 9120",
      movement: "automatic",
      powerReserveHours: 40,
      waterResistanceM: 50,
      crystal: "Sapphire",
      braceletStrap: "Italian leather (genuine) with Pin buckle",
    });
  });

  it("treats a term that repeats its value's label as a heading, leaving the field blank", () => {
    // Without labelled rows to pair, "Dial color" is a label with no value of
    // its own; blank is right, "Dial color" as the colour is not.
    const text = primaryProductText("<dl><dt>Dial</dt><dd><p>Dial color</p><p>White</p></dd></dl>");
    expect(text).toBe("Dial; Dial color; White");
    expect(extractSpecs(text).dialColor).toBeUndefined();
  });

  it("never reads a value as belonging to the next row's label", () => {
    // Label and value on separate lines, as the page's rows read when flattened
    // without their structure. Pairing these by position is a guess, so every
    // field stays blank rather than shifting by one row.
    const specs = extractSpecs("Size; Case diameter; 39 mm; Lug to lug; 49,2 mm; Case thickness; 13 mm; Lug width; 20 mm");
    expect(specs.caseDiameterMm).toBeUndefined();
    expect(specs.lugToLugMm).toBeUndefined();
    expect(specs.caseThicknessMm).toBeUndefined();
    expect(specs.lugWidthMm).toBeUndefined();
    // The row structure lost, but no boundary either: "49.2 mm Case thickness".
    expect(extractSpecs("Lug to lug 49,2 mm Case thickness 13 mm").caseDiameterMm).toBeUndefined();
    // Prose that states the value first still reads.
    expect(extractSpecs("A 40 mm case that measures 47 mm from lug to lug.")).toMatchObject({ caseDiameterMm: 40, lugToLugMm: 47 });
  });
});

describe("brand identity and scrape coverage", () => {
  it("never uses a placeholder Shopify vendor as the brand", () => {
    expect(resolveBrand({ host: "viiswatch.com", vendor: "Mein Shop" })).toBe("VIIS");
    expect(resolveBrand({ host: "example.de", vendor: "Mein Shop", ldBrand: "Laco" })).toBe("Laco");
    expect(resolveBrand({ host: "example.de", vendor: "Mein Shop", pageText: "Marke: Nordlicht; Modell: Pilot" })).toBe("Nordlicht");
    expect(resolveBrand({ host: "example.com", vendor: "Baltic", ldBrand: "Other" })).toBe("Baltic");
    expect(labeledBrand("Material: Steel; Brand : Seiko")).toBe("Seiko");
  });

  it("lets a strap-naming variant replace the stated strap, but not a colourway", () => {
    expect(variantNamesStrap("Granite Black")).toBe(false);
    expect(variantNamesStrap("Stainless Steel")).toBe(true);
    expect(variantNamesStrap("Lederarmband Cognac")).toBe(true);
  });

  it("never records Shopify's placeholder variant title as a strap", () => {
    expect(strapFromVariant("Default Title", undefined)).toBeUndefined();
    expect(strapFromVariant("Default Title", "Kalbsleder")).toBe("Kalbsleder");
    expect(strapFromVariant("Granite Black", "Kalbsleder")).toBe("Kalbsleder");
    expect(strapFromVariant("Stainless Steel", "Kalbsleder")).toBe("Stainless Steel");
    expect(strapFromVariant("Granite Black", undefined)).toBe("Granite Black");
  });

  it("reports coverage and labels a thin scrape as partial", () => {
    expect(specCoverage({ caseDiameterMm: 42, complications: "GMT" })).toEqual({
      specsFound: 2,
      specsPossible: 13,
      coverageNote: "partial — page locale or layout limited extraction",
    });
    expect(specCoverage(extractSpecs(productExtractionText(VIIS_BODY_HTML, viisPage)))).toEqual({ specsFound: 12, specsPossible: 13 });
    expect(specCoverage(undefined).specsFound).toBe(0);
  });
});

describe("plainText", () => {
  it("turns line and block breaks into one space and drops inline tags", () => {
    expect(plainText("Malouine<br>Onyx Black")).toBe("Malouine Onyx Black");
    expect(plainText("Malouine<br />\n  Ocean Blue ")).toBe("Malouine Ocean Blue");
    expect(plainText("<p>Seamaster</p><p>Diver 300M</p>")).toBe("Seamaster Diver 300M");
    expect(plainText("Mal<em>ouine</em> <span class=\"c\">Onyx</span>")).toBe("Malouine Onyx");
  });

  it("decodes entities, including markup that arrives encoded", () => {
    expect(plainText("Le Forban S&eacute;curit&eacute; Mer")).toBe("Le Forban Sécurité Mer");
    expect(plainText("Malouine&lt;br&gt;Onyx Blue")).toBe("Malouine Onyx Blue");
    expect(plainText("Tudor&rsquo;s Black&nbsp;Bay &amp; Co")).toBe("Tudor’s Black Bay & Co");
  });

  it("turns an entity it cannot decode into a space rather than guessing", () => {
    expect(plainText("Model&zzz;X")).toBe("Model X");
  });
});

describe("scrapeWatch identity fields", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("saves a model whose heading and schema name contain <br> as plain text", async () => {
    // No API key: the legacy extractor runs, so nothing leaves the test.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const url = "https://leforbansecuritemer.com/en/la-malouine/";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, url, text: async () => malouinePage })));

    const result = await scrapeWatch(url);
    expect(result.brand).toBe("Le Forban Sécurité Mer");
    expect(result.model).toBe("Malouine Onyx Black");
    expect(result.price).toEqual({ amount: 490, currency: "EUR" });
  });
});
