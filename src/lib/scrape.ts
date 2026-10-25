// Best-effort scraper that turns a retailer/product URL into a partial watch.
// Used by the /api/scrape route to pre-fill the add form. Pulls price/image/
// brand/model from structured data (Shopify JSON, JSON-LD, OpenGraph) and the
// remaining details from the page text — via the Claude API when
// ANTHROPIC_API_KEY is configured (see extract.ts), else the legacy regex
// extractor. Whatever it can't find, the user fills in.
//
// Runs server-side only (needs open outbound network). Never throws on a bad
// page — it just returns whatever it managed to extract.

import { extractWatchDetails, sanitizeSpecs } from "./extract";
import { normalizeTags } from "./categories";
import { extractRetailOffer, inferRetailCondition } from "./retailer-offer.mjs";
import { SPEC_FIELDS } from "./specs";
import { Condition, Friction, Money, MovementType, QualityFlags, WatchInput, WatchSpecs } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SYMBOL_TO_ISO: Record<string, string> = {
  "US$": "USD", "A$": "AUD", "AU$": "AUD", "C$": "CAD", "CA$": "CAD",
  $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₣": "CHF",
};

export type ScrapeResult = Partial<
  Pick<WatchInput, "brand" | "model" | "referenceNumber" | "price" | "imageUrl" | "specs" | "tags">
> & {
  retailer?: string;
  condition?: Condition;
  foundNothing?: boolean;
  qualityFlags?: QualityFlags;
  /** brandLiquidity is a user judgment call, so scraped friction is partial. */
  friction?: Partial<Friction>;
  /** How many SPEC_FIELDS the scrape filled, so a thin autofill reads as
   * partial instead of silently looking complete. */
  specsFound?: number;
  specsPossible?: number;
  coverageNote?: string;
};

async function fetchText(url: string, json = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: json ? "application/json,*/*" : "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return { ok: false as const };
    return { ok: true as const, body: await res.text(), finalUrl: res.url };
  } catch {
    return { ok: false as const };
  } finally {
    clearTimeout(timer);
  }
}

function clean(s: string): string {
  return s
    .replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function parseMoney(raw: unknown, fallback?: string): Money | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  let currency = fallback;
  const code = s.match(/\b(USD|EUR|GBP|JPY|CHF|AUD|CAD|SEK|NOK|DKK|HKD|SGD|NZD)\b/i);
  if (code) currency = code[1].toUpperCase();
  else for (const [sym, iso] of Object.entries(SYMBOL_TO_ISO)) { if (s.includes(sym)) { currency = iso; break; } }
  let num = s.replace(/[^0-9.,]/g, "");
  if (!num) return undefined;
  if (num.includes(",") && num.includes("."))
    num = num.lastIndexOf(",") > num.lastIndexOf(".") ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  else if (num.includes(",")) num = /,\d{2}$/.test(num) ? num.replace(",", ".") : num.replace(/,/g, "");
  const amount = Number(num);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return currency ? { amount, currency } : undefined;
}

function absolutize(u: string | undefined, base: string): string | undefined {
  if (!u) return undefined;
  try { return new URL(u, base).href.replace(/^http:/, "https:"); } catch { return undefined; }
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// European product pages often encode accented letters as entities. Turning
// them into spaces splits "Geh&auml;use" into two words no label can match.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", nbsp: " ", deg: "°", plusmn: "±", reg: "®", times: "×",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Eacute: "É",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  ccedil: "ç", ntilde: "ñ", oslash: "ø", Oslash: "Ø",
};

function codePoint(n: number): string | undefined {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (match, n: string) => codePoint(Number(n)) ?? match)
    .replace(/&#x([0-9a-f]+);/gi, (match, n: string) => codePoint(parseInt(n, 16)) ?? match)
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}

// A row holding a short label element and then its bare value, closing
// together: <div><p>Lug to lug</p> 49,2 mm</div>. Only the label's close is a
// boundary when flattened, so the value ran into the next row's label
// ("49,2 mm Case thickness; 13 mm Lug width") and the value-before-label
// patterns paired each value with the field below it (AV86).
const LABELED_ROW =
  /<(div|li)\b[^>]*>\s*<(p|span|strong|b|label)\b[^>]*>([^<]{1,40})<\/\2>\s*([^<]{1,120}?)\s*<\/\1>/gi;

function labeledRowText(row: string, _tag: string, _labelTag: string, label: string, value: string): string {
  const name = label.trim().replace(/\s*:$/, "");
  return name && value.trim() ? ` ${name}: ${value.trim()}; ` : row;
}

// The same pairing when the value sits in its own box after the label:
// <p>Diameter</p><div><p>41 mm</p></div> (Breitling). Flattened, each block
// ends a line, giving "Diameter; 41 mm" — and the spec patterns never pair a
// label with a value across ";", so every such row was lost. Only a box
// holding a single text element counts as a value: a section title is
// followed by more rows ("Strap" over "Strap material"), never one value, so
// it stays a heading rather than taking the next row's label as its value.
const SPLIT_ROW =
  /<(p|span|strong|label)\b[^>]*>([^<]{1,40})<\/\1>\s*<div\b[^>]*>\s*<(p|span)\b[^>]*>([^<]{1,120})<\/\3>\s*<\/div>/gi;

function splitRowText(row: string, _labelTag: string, label: string, _valueTag: string, value: string): string {
  return labeledRowText(row, "", "", label, value);
}

// A row holding exactly a label and a value, each its own text-only element:
// <li><h5>Diameter</h5><p>40 mm</p></li> (Rolex) and <div class="row">
// <div>Case lug width (mm)</div><div>19.00</div></div> (Tissot). Divs are not
// line breaks, so Tissot's table ran together ("Case material 316L … Case
// options See-through") and Rolex's read "Diameter; 40 mm"; either way the
// patterns lost the row. A product card has the same shape ("White Leather
// Strap" over "$50.00"), and pairing it would read a price as a strap, so a
// row whose value is a price is left alone. Whitespace around each text is
// outside the length limits: Tissot indents a 19-character label by 70.
const PAIR_ROW =
  /<(li|div|tr)\b[^>]*>\s*<(h[1-6]|p|span|div|th|td|dt|strong|b|label)\b[^>]*>\s*([^<]{1,60}?)\s*<\/\2>\s*<(p|span|div|td|dd)\b[^>]*>\s*([^<]{1,200}?)\s*<\/\4>\s*<\/\1>/gi;
const PRICE_VALUE = /^\s*(?:[$€£¥₣]|(?:US|A|AU|C|CA)\$|\d[\d.,\s]*\s*(?:USD|EUR|GBP|CHF|JPY|AUD|CAD)\b)/i;

function pairRowText(row: string, _tag: string, _labelTag: string, label: string, _valueTag: string, value: string): string {
  return PRICE_VALUE.test(value) ? row : labeledRowText(row, "", "", label, value);
}

/** Whether `text` opens with `label` as a whole word ("Dial color: …" opens with "Dial"). */
function opensWith(text: string, label: string): boolean {
  return text.toLowerCase().startsWith(label.toLowerCase()) && !/[A-Za-zÀ-ÿ]/.test(text.charAt(label.length));
}

// Typography that turns up in product titles. Kept out of NAMED_ENTITIES so
// the spec text the patterns read stays as it was; a name has no such patterns.
const TITLE_ENTITIES: Record<string, string> = {
  lt: "<", gt: ">", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", trade: "™", copy: "©",
};

// Tags that end a line or block. In a title they separate words ("Malouine<br>
// Onyx Black"), so they become a space; inline tags (span, em) sit inside a
// word as often as between words, so they vanish.
const BLOCK_BREAK =
  /<br\s*\/?>|<\/?(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|footer|h[1-6]|header|hr|li|ol|p|section|table|td|th|tr|ul)\b[^>]*>/gi;

/**
 * A free-text identity field (brand, model, reference) as plain text. Product
 * headings and JSON-LD names carry layout markup — a theme that breaks the
 * model name over two lines puts a literal `<br>` in the h1 and the schema
 * name alike — and that markup used to be saved as part of the model. Entities
 * are decoded first so markup that arrives encoded (`&lt;br&gt;` in a meta
 * attribute) is removed too. Unknown entities become a space, never a guess.
 */
export function plainText(s: string): string {
  return decodeEntities(s.replace(/&([a-z]+);/gi, (match, name: string) => TITLE_ENTITIES[name] ?? match))
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_BREAK, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripText(html: string): string {
  return decodeEntities(
    html
      // Keep definition-list labels and boundaries: flattening them loses the
      // difference between a specification and surrounding marketing prose.
      .replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi, (_, label: string, value: string) => {
        const key = stripText(label);
        const names: Record<string, string> = { case: "Case material", dial: "Dial color", winding: "Movement" };
        // Inside one definition a line break continues the same value
        // ("stainless steel, screwed / stainless steel back"), so it stays a
        // space here rather than the field boundary it is elsewhere.
        const joined = value.replace(/<br\s*\/?>/gi, " ");
        const body = key.toLowerCase() === "dimensions"
          ? joined.replace(/\bheight\b/gi, "case height") : joined;
        const text = stripText(body);
        // A term over its own labelled rows ("Size" over "Case diameter",
        // "Dial" over "Dial color") is a group heading, not a label. As a label
        // it read "Dial color: Dial color; White" and stored the label as the
        // colour, so it stays a heading and the rows keep their own labels.
        const name = names[key.toLowerCase()] ?? key;
        const hasRows = body.replace(LABELED_ROW, labeledRowText) !== body;
        if (hasRows || opensWith(text, key) || opensWith(text, name)) return ` ${key}; ${text}; `;
        return ` ${name}: ${text}; `;
      })
      .replace(LABELED_ROW, labeledRowText)
      .replace(SPLIT_ROW, splitRowText)
      .replace(PAIR_ROW, pairRowText)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      // Paragraph, line and heading boundaries become "; ". Without them a
      // value runs into the next panel's label, and a heading-style spec
      // ("ARMBAND" over "Kalbsleder") can't be told from one long sentence.
      .replace(/<br\s*\/?>/gi, "; ")
      .replace(/<\/(?:p|li|h[1-6]|summary|td|th|tr)>/gi, "; ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*(?:;\s*)+/g, "; ")
    .replace(/^[\s;]+|[\s;]+$/g, "")
    .trim();
}

type Extracted = { brand?: string; name?: string; ref?: string; price?: Money; image?: string };

// Some direct-to-consumer Shopify stores use the vendor field for a collection
// name rather than the manufacturer. Keep verified exceptions narrow: on a
// marketplace, replacing a real product brand with the retailer would be worse.
const DOMAIN_BRANDS: Record<string, string> = {
  "maenwatches.com": "Maen",
  "spinnaker-watches.com": "Spinnaker",
  "viiswatch.com": "VIIS",
  // The page's product schema names no brand, only "Rolex GMT-Master II watch: …".
  "rolex.com": "Rolex",
};

// Shopify's default vendor is the store's placeholder name in the admin
// language. It names no manufacturer, so it must never become the brand.
const PLACEHOLDER_VENDORS = /^(?:my store|mein shop|ma boutique|mi tienda|il mio negozio|minha loja|mijn winkel|default vendor)$/i;

/** A brand stated as a labeled spec ("Marke: VIIS"), in any supported locale. */
export function labeledBrand(text: string): string | undefined {
  return text.match(/(?:^|;\s*)(?:Marke|Brand|Marque|Marca)\s*:\s*([^;]{2,40}?)\s*(?=;|$)/i)?.[1].trim();
}

/** Verified domain mapping first, then a real Shopify vendor, then JSON-LD,
 * then a labeled brand on the page. A placeholder vendor is skipped. */
export function resolveBrand({ host, vendor, ldBrand, pageText = "" }: {
  host: string;
  vendor?: string;
  ldBrand?: string;
  pageText?: string;
}): string | undefined {
  const usableVendor = vendor && !PLACEHOLDER_VENDORS.test(vendor.trim()) ? vendor : undefined;
  return DOMAIN_BRANDS[host] || usableVendor || ldBrand || labeledBrand(pageText);
}

function fromJsonLd(html: string, base: string): Extracted {
  const out: Extracted = {};
  for (const b of Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    let data: unknown;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const nodes: Record<string, unknown>[] = [];
    const push = (d: unknown) => { if (d && typeof d === "object") nodes.push(d as Record<string, unknown>); };
    if (Array.isArray(data)) data.forEach(push);
    else { push(data); const g = (data as Record<string, unknown>)?.["@graph"]; if (Array.isArray(g)) g.forEach(push); }

    for (const n of nodes) {
      const type = n["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && (type as unknown[]).includes("Product"));
      if (!isProduct) continue;
      if (!out.name && typeof n.name === "string") out.name = plainText(n.name);
      if (!out.brand) {
        const brand = n.brand as { name?: string } | string | undefined;
        const bn = typeof brand === "string" ? brand : brand?.name;
        if (bn) out.brand = plainText(bn);
      }
      if (!out.ref) {
        const ref = (n.mpn ?? n.sku) as string | number | undefined;
        if (ref != null) out.ref = plainText(String(ref));
      }
      if (!out.image) {
        let img = n.image as unknown;
        if (Array.isArray(img)) img = img[0];
        if (img && typeof img === "object") img = (img as { url?: string; contentUrl?: string }).url ?? (img as { contentUrl?: string }).contentUrl;
        if (typeof img === "string") out.image = absolutize(img, base);
      }
      if (!out.price) {
        let offers = n.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
        if (Array.isArray(offers)) offers = offers[0];
        if (offers) {
          const m = parseMoney(offers.price ?? offers.lowPrice ?? offers.highPrice, offers.priceCurrency as string | undefined);
          if (m) out.price = m;
        }
      }
    }
  }
  return out;
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const n of names) {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i"));
    if (a) return a[1];
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, "i"));
    if (b) return b[1];
  }
  return undefined;
}

function fromMeta(html: string, base: string): Extracted {
  const out: Extracted = {};
  const img = metaContent(html, ["og:image:secure_url", "og:image", "twitter:image"]);
  if (img) out.image = absolutize(img, base);
  const title = metaContent(html, ["og:title", "twitter:title"]);
  // Decode before splitting: an encoded dash ("&ndash;") is still the separator.
  if (title) out.name = plainText(title).split(/\s[|–—-]\s/)[0].trim();
  const m = parseMoney(
    metaContent(html, ["product:price:amount", "og:price:amount", "price"]),
    metaContent(html, ["product:price:currency", "og:price:currency", "priceCurrency"])
  );
  if (m) out.price = m;
  return out;
}

// Shopify exposes a clean product JSON at <origin>/products/<handle>.json.
type ShopifyVariant = {
  id?: string | number;
  title?: string;
  price?: string;
  price_currency?: string;
  available?: boolean;
  sku?: string;
  featured_image?: { src?: string } | null;
};

export function selectShopifyVariant(url: string, variants: ShopifyVariant[]): ShopifyVariant | undefined {
  let requestedId: string | null = null;
  try { requestedId = new URL(url).searchParams.get("variant"); } catch { /* use availability fallback */ }
  return variants.find((variant) => requestedId && String(variant.id) === requestedId)
    ?? variants.find((variant) => variant.available)
    ?? variants[0];
}

export function shopifyProductJsonUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const productsIndex = parts.indexOf("products");
    const handle = productsIndex >= 0 ? parts[productsIndex + 1] : undefined;
    if (!handle) return undefined;
    const prefix = parts.slice(0, productsIndex).join("/");
    return `${parsed.origin}/${prefix ? `${prefix}/` : ""}products/${handle}.json`;
  } catch {
    return undefined;
  }
}

export function isShopifyCollectionUrl(url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.includes("collections") && !parts.includes("products");
  } catch {
    return false;
  }
}

async function fromShopify(url: string) {
  const jsonUrl = shopifyProductJsonUrl(url);
  if (!jsonUrl) return null;
  const r = await fetchText(jsonUrl, true);
  if (!r.ok || !r.body) return null;
  let data: { product?: Record<string, unknown> };
  try { data = JSON.parse(r.body); } catch { return null; }
  const p = data.product;
  if (!p) return null;
  const variants = (p.variants as ShopifyVariant[]) || [];
  const v = selectShopifyVariant(url, variants);
  const out: { vendor?: string; title?: string; variantTitle?: string; ref?: string; price?: Money; image?: string; bodyHtml?: string } = {};
  if (typeof p.vendor === "string") out.vendor = plainText(p.vendor);
  if (typeof p.title === "string") out.title = plainText(p.title);
  if (v?.title) out.variantTitle = plainText(v.title);
  if (v?.sku) out.ref = plainText(v.sku);
  if (v?.price != null) out.price = parseMoney(String(v.price), v.price_currency);
  const images = (p.images as { src?: string }[]) || [];
  const image = v?.featured_image?.src ?? images[0]?.src;
  if (image) out.image = absolutize(image, new URL(url).origin);
  if (typeof p.body_html === "string") out.bodyHtml = p.body_html;
  return out;
}

function firstHeading(html: string): string | undefined {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  // plainText, not stripText: a <br> in a heading is a space, not the field
  // boundary stripText makes of it in spec text.
  return match ? plainText(match[1]) || undefined : undefined;
}

/**
 * Prefer the product's main/specification content over the entire storefront.
 * Header navigation, size guides, cross-sells and footer copy routinely contain
 * other diameters, movements and complications that look like product specs.
 *
 * Section names are matched in EN, DE, FR, ES and IT. "Abmessungen" (and
 * "Dimensions") is deliberately not an anchor: it is usually one sub-panel
 * among several, and starting there would cut the movement and case panels
 * above it. Pages built only from such panels reach the dense-label fallback
 * in productExtractionText instead.
 */
const TECHNICAL_HEADINGS =
  /^(?:Specifications?|Technical (?:Details|Data)|Tech Specs|Spezifikationen|Technische (?:Daten|Details)|Spécifications?|Caractéristiques techniques|Especificaciones|Ficha técnica|Specifiche(?: tecniche)?|Scheda tecnica)$/i;

const TECHNICAL_SECTION_ANCHORS = [
  /\bSpecifications?\b/i,
  /\bTechnical (?:Details|Data)\b/i,
  /\bDetails\s+Price\b/i,
  /\bTech Specs\b/i,
  /\bSpezifikationen\b/i,
  /\bTechnische (?:Daten|Details)\b/i,
  /\bSpécifications?\b/i,
  /\bCaractéristiques techniques\b/i,
  /\bEspecificaciones\b/i,
  /\bFicha técnica\b/i,
  /\bSpecifiche(?: tecniche)?\b/i,
  /\bScheda tecnica\b/i,
];

// Where the product ends and the storefront resumes. Letter lookarounds
// rather than \b, which treats accented letters as word boundaries. A review
// heading split over two elements ("PRESS & CUSTOMER / REVIEWS") still ends
// the product: a customer's "the micro adjust helps" is not a spec. So does a
// "Testimonials" block, which on Henry Archer precedes feature panels for other
// models ("Dacnis: Sapphire bezel") and reviews of other watches.
const PRODUCT_END =
  /(?<![A-Za-zÀ-ÿ])(?:You may also like|Customers? Also Love|Recently viewed|(?:Press\s*(?:&|and)\s*)?Customers?[\s;]+reviews|FAQs?|Our Collections|Discover next|Testimonials|Kundenstimmen|Témoignages|Testimonios|Testimonianze|Kundenbewertungen|Das könnte (?:dir|Ihnen) auch gefallen|Ähnliche Produkte|Zuletzt angesehen|Vous aimerez aussi|Avis clients|Récemment consultés|También te puede gustar|Opiniones de clientes|Vistos recientemente|Potrebbe piacerti anche|Recensioni dei clienti|Visti di recente)(?![A-Za-zÀ-ÿ])/i;

function technicalSectionStart(text: string): number {
  for (const anchor of TECHNICAL_SECTION_ANCHORS) {
    const start = text.search(anchor);
    if (start >= 0) return start;
  }
  return -1;
}

function cutAtProductEnd(text: string): string {
  const end = text.search(PRODUCT_END);
  return (end > 0 ? text.slice(0, end) : text).replace(/[\s;]+$/, "").trim();
}

export function primaryProductText(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  // Prefer a real section heading to anchor-navigation text. A nav link named
  // "Specifications" may precede a FAQ link that would truncate the entire page.
  const heading = Array.from(main.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi))
    .find(match => TECHNICAL_HEADINGS.test(stripText(match[1])));
  const text = stripText(heading ? main.slice(heading.index) : main);
  const specStart = technicalSectionStart(text);
  if (specStart === -1) return text;
  // Keep later product feature panels: brands often state the caliber and
  // power reserve below shipping accordions rather than in the spec table.
  return cutAtProductEnd(text.slice(specStart));
}

/** "11,3 mm" → "11.3 mm". Only a comma followed by one or two digits, so a
 * thousands separator ("28,800 bph") is left alone. */
function normalizeDecimals(text: string): string {
  return text.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2");
}

const L2L_LABEL =
  "(?:lug[\\s-]*to[\\s-]*lug|Abstand der Bandanstöße|Bandanstöße|Horn[\\s-]*zu[\\s-]*Horn|Anstoß[\\s-]*zu[\\s-]*Anstoß|(?:longueur\\s+)?(?:de\\s+)?corne\\s+à\\s+corne|distancia entre asas|de asa a asa|da ansa ad ansa)";
const THICKNESS_LABEL =
  "(?:thickness|case height|case depth|depth|thick|Gehäusehöhe|Gehäusedicke|(?<![A-Za-zÀ-ÿ])Höhe|(?<![A-Za-zÀ-ÿ])Dicke|épaisseur|hauteur|espesor|grosor|spessore|altezza)";

/**
 * How many independent spec facts a text states outright: a caliber, a water
 * rating, a lug-to-lug and a case height. Marketing copy ("a case diameter of
 * 42 mm") rarely carries more than one; a real spec panel carries several.
 */
export function strongSpecSignals(text: string): number {
  const t = normalizeDecimals(text);
  return [
    /\b(?:Miyota|Seiko|Sellita|ETA|Ronda|Soprod|La Joux[ -]Perret|Seagull)\s+[A-Z0-9]*\d|\b(?:cali(?:ber|bre|bro)|Kaliber)\s*:/i,
    /(?:water[\s-]*resist|wasserdicht|étanch|resistencia al agua|impermeabil)[^0-9]{0,20}\d{2,4}\s?m\b|\b\d{1,3}\s?(?:atm|bars?)\b/i,
    new RegExp(`${L2L_LABEL}[^0-9]{0,16}\\d{2}`, "i"),
    new RegExp(`${THICKNESS_LABEL}[^0-9]{0,24}\\d{1,2}(?:\\.\\d{1,2})?\\s?mm`, "i"),
  ].filter((pattern) => pattern.test(t)).length;
}

/** Below this, or with fewer than two spec facts, a Shopify description is
 * treated as marketing rather than a specification. */
const THIN_DESCRIPTION_CHARS = 1200;

/**
 * Shopify's product description is already scoped to the requested product.
 * Appending the full rendered page reintroduces variant selectors, recommendations,
 * and hidden quick-view cards whose specs can be mistaken for the primary watch.
 */
export function productExtractionText(
  shopifyBodyHtml: string | undefined,
  html: string,
  collectionPage = false
): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  const mainText = stripText(main);
  const hasTechnicalSection = technicalSectionStart(mainText) >= 0;

  // A collection is safe only when the page exposes a dedicated, bounded
  // technical section for that family. Otherwise its product cards are
  // inseparable and returning no specs is more honest than mixing models.
  if (collectionPage) return hasTechnicalSection ? primaryProductText(html) : "";
  if (hasTechnicalSection) return primaryProductText(html);
  if (!shopifyBodyHtml) return mainText;

  const body = stripText(shopifyBodyHtml);
  // A marketing-only description must not hide a spec panel the page does
  // render. Use the page only when it states several spec facts itself, so a
  // lone cross-sell mention can't qualify, and stop where the product ends.
  const thinBody = body.length < THIN_DESCRIPTION_CHARS || strongSpecSignals(body) < 2;
  if (thinBody && strongSpecSignals(mainText) >= 3) return cutAtProductEnd(mainText);
  return body;
}

function num(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  return m ? Number(m[1]) : undefined;
}

// "Automatic, hand-winding possible" describes an automatic. Secondary
// hand-winding is dropped before classifying, or the manual pattern wins.
const HAND_WINDING_CAPABILITY =
  /(?:hand[\s-]?(?:wound|wind(?:ing)?)|manual[\s-]?wind(?:ing)?|handaufzug|remontage manuel|carica manuale|cuerda manual)\s*(?:möglich|possible|capability|capable|function|funktion)|\b(?:with|mit|avec|con|and|und|et|y|e)\s+(?:(?:hand|manual)[\s-]?wind(?:ing)?|handaufzug|remontage manuel|carica manuale|cuerda manual)/gi;

// Colour words for reading a bare "Dial:" row; anything else there is not a colour.
const DIAL_COLOUR =
  "(?:black|white|blue|navy|green|grey|gray|silver|red|orange|yellow|brown|chocolate|espresso|pink|salmon|purple|teal|turquoise|cream|ivory|champagne|gold|bronze|copper|beige|tan|anthracite|slate|burgundy|olive|khaki|sand|mint|aqua|azure)";

export function extractSpecs(text: string): WatchSpecs {
  const t = normalizeDecimals(text.replace(/\s+/g, " "));
  const low = t.toLowerCase();
  const s: WatchSpecs = {};

  // Gaps between a label and its value never cross ". ; ,": in "40 mm
  // diameter. 20 mm lug width." the label is followed by the next field's
  // number, and reading it as the diameter also voids lug-to-lug in sanitizing.
  s.caseDiameterMm =
    num(t, /(?:case\s*)?(?:diameter|case size|case width)\s*\(\s*mm\s*\)\s*[:\-]?\s*(\d{2}(?:\.\d{1,2})?)/i) ??
    num(t, /(?:case\s*)?(?:diameter|case size|case width|(?<![A-Za-zÀ-ÿ])(?:Gehäuse)?durchmesser|diamètre(?: du boîtier)?|diámetro(?: de la caja)?|diametro(?: della cassa)?)[^0-9.;,]{0,12}(\d{2}(?:\.\d{1,2})?)\s?mm/i) ??
    num(t, /Ø\s?(\d{2}(?:\.\d{1,2})?)\s?mm/i) ??
    // A value read before its label ("40 mm case") stops at a field boundary
    // too, and "case" must not be the next row's label: in "49.2 mm; Case
    // thickness" the number is the lug-to-lug above it.
    num(t, /\b(\d{2}(?:\.\d{1,2})?)\s?mm\b(?=[^.;]{0,18}(?:case(?!\s*(?:thickness|height|depth|back))|diameter))/i);

  // Total height including the crystal is what most brands quote, and the
  // score compares it across brands (lower is better). A figure stated as
  // excluding the crystal would flatter one page against the rest, so it is
  // removed before matching; a page giving only that height leaves this blank.
  const withoutCrystal = new RegExp(
    `${THICKNESS_LABEL}\\s*\\(\\s*(?:exkl\\.?|excl\\.?|excluding|without|ohne|sans|sin|senza)[^)]*\\)[^0-9]{0,6}\\d{1,2}(?:\\.\\d{1,2})?\\s?mm`,
    "gi"
  );
  const withCrystal = new RegExp(
    `${THICKNESS_LABEL}\\s*\\(\\s*(?:inkl\\.?|incl\\.?|including|with|avec|con|incluso|incluido)\\s*(?:Glas|crystal|glass|verre|cristal|vetro)\\s*\\)[^0-9]{0,6}(\\d{1,2}(?:\\.\\d{1,2})?)\\s?mm`,
    "i"
  );
  const th = t.replace(withoutCrystal, " ");
  s.caseThicknessMm =
    num(th, withCrystal) ??
    num(th, /(?:thickness|case height|case depth|depth|thick(?:ness)?)\s*\(\s*mm\s*\)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)/i) ??
    num(th, /(?:thickness|case height|case depth|depth|thick)[^0-9.;,]{0,12}(\d{1,2}(?:\.\d{1,2})?)\s?mm/i) ??
    num(th, /(?:Gehäusehöhe|Gehäusedicke|(?<![A-Za-zÀ-ÿ])Höhe|(?<![A-Za-zÀ-ÿ])Dicke|épaisseur|hauteur du boîtier|espesor|grosor|spessore|altezza della cassa)[^0-9.;,]{0,12}(\d{1,2}(?:\.\d{1,2})?)\s?mm/i) ??
    num(th, /\b(\d{1,2}(?:\.\d{1,2})?)\s?mm\b(?=[^.;]{0,14}(?:thick|height|depth))/i);

  s.lugToLugMm =
    num(t, new RegExp(`${L2L_LABEL}[^0-9.;,]{0,16}(\\d{2}(?:\\.\\d{1,2})?)(?:\\s?mm)?`, "i")) ?? // "lug to lug (mm): 47"
    num(t, /(\d{2}(?:\.\d{1,2})?)\s?mm[^.;]{0,12}(?:from\s+)?lug[\s-]*to[\s-]*lug/i); // "measures 46mm from lug to lug"
  // Buckle width ("Schließenbreite") is not lug width and is never matched.
  s.lugWidthMm =
    // "Lug width (in-between lug): 20 mm" — a qualifier in brackets is skipped.
    num(t, /lug[\s-]*width\s*\([^)]{1,30}\)\s*:\s*(\d{2})\s?mm/i) ??
    // "Case lug width (mm): 19.00" (Tissot): the unit is in the label.
    num(t, /lug[\s-]*width\s*\(\s*mm\s*\)\s*:\s*(\d{2})(?:\.0+)?(?![\d.])/i) ??
    num(t, /(?:lug[\s-]*width|Anstoßbreite|Bandanstoßbreite|Bandbreite|Stegbreite|largeur (?:des |entre )?cornes|entre-?cornes|ancho (?:de )?(?:las )?asas|ancho (?:de )?(?:la )?correa|larghezza (?:delle )?anse|larghezza (?:del )?cinturino)[^0-9.;,]{0,14}(\d{2})\s?mm/i) ??
    num(t, /strap[\s-]*width[^0-9.;,]{0,12}(\d{2})\s?mm/i) ??
    num(t, /\b(\d{2})\s?mm\s+(?:lug|strap)[\s-]*width\b/i) ?? // "20 mm lug width"
    num(t, /\bband\b[^0-9]{0,8}(\d{2})\s?mm/i);
  s.powerReserveHours =
    num(t, /power[\s-]*reserve[^0-9]{0,28}(\d{2,3})\s?h\b/i) ??
    num(t, /(\d{2,3})\s?h(?:ours?|rs?)?\s*(?:of\s*)?power[\s-]*reserve/i) ?? // "42 hrs power-reserve"
    num(t, /power[\s-]*reserve[^0-9]{0,28}(\d{2,3})\s*(?:hours?|hrs?)\b/i) ??
    num(t, /(?:Gangreserve|réserve de marche|reserva de marcha|riserva di carica)[^0-9]{0,28}(\d{2,3})\s*(?:h\b|Std\.?|Stunden|heures|horas|ore\b)/i) ??
    num(t, /(\d{2,3})\s*(?:Stunden|Std\.?|heures|horas|ore)\s*(?:de\s+|di\s+)?(?:Gangreserve|réserve de marche|reserva de marcha|riserva di carica)/i);

  const wm =
    // "Waterproof to 100 metres" (Rolex): a spelled-out unit, not just "m".
    t.match(/water[\s-]*resist[a-z]*[^0-9]{0,24}(\d{2,4})\s?m(?:et(?:er|re)s?)?\b/i) ||
    t.match(/(?:Wasserdichtigkeit|wasserdicht(?:\s+bis)?|étanchéité|étanche|resistencia al agua|hermeticidad|impermeabilità|impermeabile)[^0-9]{0,16}(\d{2,4})\s?m\b/i) ||
    t.match(/(\d{2,4})\s?m(?:eters)?\s*(?:of\s*)?water/i);
  // "3 bars (30 m /99 ft)": the plural failed \b after "bar".
  const atm = t.match(/(\d{1,3})\s?(?:atm|bars?)\b/i);
  if (wm) s.waterResistanceM = Number(wm[1]);
  else if (atm) s.waterResistanceM = Number(atm[1]) * 10;

  const moves: [RegExp, MovementType][] = [
    [/spring[\s-]?drive/, "spring-drive"],
    [/meca[\s-]?quartz|mecaquartz/, "quartz"],
    [/quartz|quarz|cuarzo|quarzo/, "quartz"],
    [/hand[\s-]?wound|hand[\s-]?wind(?:ing)?|manual[\s-]?wind(?:ing)?|manual winding|handaufzug|remontage manuel|carica manuale|cuerda manual/, "manual"],
    [/self[\s-]?winding|autom[aá]ti(?:c|k|que|co)/, "automatic"],
    [/solar/, "solar"],
    [/kinetic/, "kinetic"],
  ];
  // A labeled spec wins over later page copy such as "instruction manual" or
  // generic collection descriptions mentioning other movement types. A label
  // that names no movement ("Type: Diver") falls through to the page text.
  const classify = (source: string | undefined, labeled: boolean): MovementType | undefined => {
    if (!source) return undefined;
    if (labeled && /^manual\b/i.test(source)) return "manual";
    return moves.find(([re]) => re.test(source))?.[1];
  };
  const labeledMovement = t
    .match(/\b(?:movement|Typ|Type|mouvement|movimiento|movimento)\s*:\s*([^.;]{2,100})/i)?.[1]
    ?.toLowerCase()
    .replace(HAND_WINDING_CAPABILITY, " ")
    .trim();
  s.movement = classify(labeledMovement, true) ?? classify(low.replace(HAND_WINDING_CAPABILITY, " "), false);

  const cal =
    t.match(/\b(?:cali(?:ber|bre|bro)|Kaliber)\s*:\s*([A-Za-z0-9][\w .\-\/]{1,30})/i) ??
    t.match(/(?:cali(?:ber|bre|bro)|kaliber)\s*[:\-]?\s*([A-Za-z0-9][\w .\-\/]{1,30})/i);
  // Powermatic is Swatch Group's ETA-based family (Tissot, Certina, Hamilton
  // as H-10 aside); Tissot names it only in feature copy, never in the table.
  const namedMovement = t.match(/\b((?:Miyota|Seiko|Sellita|ETA|Ronda|Soprod|La Joux[ -]Perret|Seagull|Powermatic)\s+[A-Z0-9][A-Z0-9.\-]{1,15})(?=[\s;,)]|$)/i);
  if (cal || namedMovement) {
    // A maker + caliber token is stronger than a loose "calibre" label,
    // which marketing prose sometimes follows with "beats at 28,800...".
    const match = namedMovement ?? cal!;
    let c = match[1].split(/\s+(?:automatic|automatik|automatique|autom[aá]tico|manual|self|swiss|cosc|movement|mouvement|movimiento|movimento|uhrwerk|handaufzug|winding|finishe?s?|with|hand|\d+\s?jewel)/i)[0].trim();
    c = c.replace(/[.,;:]+$/, "").trim();
    if (c.length >= 2 && /\d/.test(c)) s.caliber = c; // require a digit to avoid grabbing prose
  }

  if (/sapphire|saphir|zafiro|zaffiro/.test(low)) s.crystal = "Sapphire";
  else if (/acrylic|acryl|hesalite|hesalit|plexi/.test(low)) s.crystal = "Acrylic";
  else if (/mineral|minéral/.test(low)) s.crystal = "Mineral";
  else if (/hardlex/.test(low)) s.crystal = "Hardlex";

  const caseMaterial =
    t.match(/case material\s*[:\-]?\s*([^.;]{3,60})/i) ??
    t.match(/(?:Gehäusematerial|matériau du boîtier|material de la caja|materiale della cassa)\s*[:\-]?\s*([^.;]{3,60})/i) ??
    // Directly under a case heading or panel, a bare "Material:" is the case's.
    t.match(/(?<![A-Za-zÀ-ÿ])(?:Gehäuse|Case|Boîtier|Caja|Cassa)\s*;\s*Material\s*:\s*([^.;]{3,60})/i) ??
    // Rolex: "Model case: Oyster, 40 mm…; Diameter: 40 mm; Material: Oystersteel".
    // Still the case section only while no bracelet, strap, dial or movement
    // heading has started; the bracelet's "Material:" comes later.
    t.match(/(?<![A-Za-zÀ-ÿ])Model case\s*[:;](?:(?!(?<![A-Za-zÀ-ÿ])(?:Bracelet|Strap|Dial|Movement)(?![A-Za-zÀ-ÿ]))[^]){0,400}?(?<![A-Za-zÀ-ÿ])Material\s*:\s*([^.;]{3,60})/i);
  if (caseMaterial) s.caseMaterial = clean(caseMaterial[1]).split(/\s+(?:case finish|case size|diameter|thickness|bezel|crystal)\b/i)[0].trim();
  const dialColor =
    t.match(/dial colou?r\s*[:\-]\s*([A-Za-z][A-Za-z /\-]{1,30})/i) ??
    // A bare "Dial: Black" row (Rolex). Only when the value names a colour: a
    // "Dial" row can describe something else ("Lume — Hands: Swiss, Dial:
    // Swiss" on Sheffield is the lume's origin).
    t.match(new RegExp(`(?<![A-Za-zÀ-ÿ])Dial\\s*:\\s*((?:[A-Za-z][A-Za-z\\-]*\\s+){0,3}?${DIAL_COLOUR}(?:\\s+[A-Za-z][A-Za-z\\-]*){0,3})(?=\\s*(?:;|$))`, "i"));
  if (dialColor) s.dialColor = clean(dialColor[1]).split(/\s+(?:index|lens|crystal|case)\b/i)[0].trim();
  const band =
    // Not the tail of another label: "Weight inc. Strap: 178g" is a weight.
    t.match(/(?<!(?:weight|inc\.?|incl\.?|including|with)\s+)\b(?:band|bracelet|strap)(?:\s+material)?\s*:\s*([^.;]{3,100})/i) ??
    t.match(/(?<![A-Za-zÀ-ÿ])(?:Armband(?:material)?|Bandmaterial|Correa|Cinturino|Bracelete)\s*:\s*([^.;]{3,100})/i);
  if (band) {
    const value = clean(band[1]).split(/\s+(?:extra band|water resistance|weight|warranty|lug width)\b/i)[0].trim();
    // Repeated option-picker prose is not a material/specification.
    const firstHalf = value.slice(0, Math.floor(value.length / 2)).toLowerCase();
    const secondHalf = value.slice(Math.floor(value.length / 2)).toLowerCase();
    if (value.length < 90 && !secondHalf.includes(firstHalf.slice(0, 20))) s.braceletStrap = value;
  } else {
    // Heading-style panels put the value on the line below the section name,
    // sometimes behind a bullet ("• Bracelet / 316L stainless steel BoR
    // bracelet. 20 mm width."). The value ends at its first sentence, and a
    // bare width ("20 mm") is a measurement, not a strap.
    const underHeading = t.match(/(?:^|;\s*)(?:[•·▪–-]\s*)?(?:Armband|Strap|Bracelet|Correa|Cinturino)\s*;\s*([A-Za-zÀ-ÿ0-9][^;.]{2,80})/i);
    // Nor is the next row's label: under "Strap" sat "Strap material", and it
    // was stored as the strap.
    if (
      underHeading &&
      !/^\d+(?:\.\d+)?\s*mm\b/i.test(underHeading[1]) &&
      !/^(?:strap|bracelet|band)\s+(?:material|colou?r|type|width)\b/i.test(underHeading[1])
    ) s.braceletStrap = clean(underHeading[1]);
  }

  const comps: string[] = [];
  const compMap: [RegExp, string][] = [
    [/chronograph/, "Chronograph"], [/\bgmt\b/, "GMT"], [/world[\s-]?timer/, "Worldtimer"],
    [/moon[\s-]?phase/, "Moon phase"], [/perpetual calendar/, "Perpetual calendar"],
    [/annual calendar/, "Annual calendar"], [/tourbillon/, "Tourbillon"], [/tachymeter/, "Tachymeter"],
  ];
  for (const [re, label] of compMap) if (re.test(low)) comps.push(label);
  if (comps.length) s.complications = comps.join(", ");

  for (const k of Object.keys(s) as (keyof WatchSpecs)[]) if (s[k] === undefined) delete s[k];
  return sanitizeSpecs(s);
}

export function extractQualityFlags(text: string, variantTitle?: string): QualityFlags {
  const t = text.replace(/\s+/g, " ");
  const flags: QualityFlags = {};

  const positions = t.match(/(?:adjusted|regulated)[^.;]{0,40}\b(?:in\s+)?(\d+)\s+positions?\b/i);
  if (positions) flags.regulatedPositions = Number(positions[1]);

  const asymmetricAccuracy = t.match(/([+-]?\d+(?:\.\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?)\s*(?:sec(?:onds?)?|s)\s*(?:\/|per\s*)?(?:day|d)\b/i);
  const symmetricAccuracy = t.match(/(?:\+\s*\/\s*-|±)\s*(\d+(?:\.\d+)?)\s*(?:sec(?:onds?)?|s|spd)\b/i);
  if (asymmetricAccuracy) {
    flags.accuracySpecSpd = Math.max(Math.abs(Number(asymmetricAccuracy[1])), Math.abs(Number(asymmetricAccuracy[2])));
  } else if (symmetricAccuracy) {
    // A range ("+/-5 seconds per day to +/-12 seconds per day", William Wood
    // quoting Sellita's grades) is only as good as its worst end.
    const rangeEnd = t
      .slice((symmetricAccuracy.index ?? 0) + symmetricAccuracy[0].length)
      .match(/^[^.;]{0,30}?\bto\s*(?:\+\s*\/\s*-|±)\s*(\d+(?:\.\d+)?)/i);
    flags.accuracySpecSpd = Math.max(Number(symmetricAccuracy[1]), Number(rangeEnd?.[1] ?? 0));
  } else if (/\bCOSC\b|\bMETAS\b|\bMaster Chronometer\b/i.test(t)) {
    // A certification is a published accuracy bound, not a guess: COSC is
    // -4/+6 s/day. METAS is recorded at the same 6, never better, because
    // brands quote it differently (Omega's own page says 0/+6). A stated
    // figure wins over either.
    flags.accuracySpecSpd = 6;
  }

  if (/\bsapphire\s+(?:crystal\s+)?(?:bezel|insert)\b|\bbezel[^.;]{0,50}\bsapphire\s+insert\b/i.test(t)) {
    flags.sapphireBezelInsert = true;
  }
  // A ceramic insert is named with the bezel or insert, so a ceramic case,
  // dial or ball bearing never counts. Rolex calls it Cerachrom.
  // "ceramic or steel bezels" offers a choice across a range and states neither
  // for this model (EREBUS), so it stays unknown.
  if (
    !flags.sapphireBezelInsert &&
    !/\bceramic\s+or\s+\w+|\w+\s+or\s+ceramic\b/i.test(t) &&
    /\bCerachrom\b|\bceramic\s+(?:bezel|insert)\b|\b(?:bezel|insert)\s+(?:in|of|made of)\s+ceramic\b|\bbezel(?:\s+insert)?\s*[:;]\s*(?:[^.;]{0,30}\s)?ceramic\b/i.test(t)
  ) {
    flags.ceramicBezelInsert = true;
  }
  // An aluminium insert is recorded evidence that the bezel is neither, which
  // is not the same as not knowing: coverage counts it, the score doesn't.
  if (
    flags.sapphireBezelInsert === undefined &&
    flags.ceramicBezelInsert === undefined &&
    /\balumin(?:i)?um\s+(?:bezel|insert)\b|\b(?:bezel|insert)\s+(?:in|of|made of)\s+alumin(?:i)?um\b|\bbezel(?:\s+insert)?\s*[:;]\s*(?:[^.;]{0,30}\s)?alumin(?:i)?um\b/i.test(t)
  ) {
    flags.sapphireBezelInsert = false;
    flags.ceramicBezelInsert = false;
  }
  // A stated surface hardness, from a hardening clause ("hardened to 1200 HV",
  // "case with 1200HV hardness coating"). Not a bracelet's or clasp's, which
  // says nothing about the case, whether the bracelet is named before the
  // figure or after it ("hardened to 1200 Vickers, the bracelet tapers" on
  // Straum). Not a bare material hardness either, which any steel has. The
  // first qualifying figure wins: UBIQ's "1200HV hardness coating (600HV on
  // black DLC models)" is the standard case, the second a variant.
  for (const hv of t.matchAll(/(\d{1,2}[.,]\d{3}|\d{3,4})\s*(?:HV|Vickers)\b/gi)) {
    const at = hv.index ?? 0;
    const before = t.slice(Math.max(0, at - 80), at);
    const clause = before.split(/[.;]/).pop() ?? "";
    const after = t.slice(at + hv[0].length).split(/[.;]/)[0].slice(0, 60);
    if (/bracelet|strap|clasp|buckle|\bband\b|armband/i.test(before + after)) continue;
    if (!/harden|coat|DLC|treat|surface|tegiment|diashield/i.test(clause + after)) continue;
    const value = Number(hv[1].replace(/[.,]/g, ""));
    if (value >= 300 && value <= 3000) {
      flags.hardenedCoatingHv = value;
      break;
    }
  }
  if (/\bdrilled\s+lugs?\b|\blug holes?\b|\bdurchbohrte?\s+(?:Band)?anst/i.test(t)) flags.drilledLugs = true;
  // A stated layer count ("6-layer AR coating", "AR coating (6 layers)",
  // "6-fach entspiegelt") is recorded as arLayers, which scores above a plain
  // arCoated; reducing it to a boolean would discard what the brand published.
  // "AR" is expanded case-sensitively first, so ordinary words never count.
  const arText = t.replace(/\bAR\b/g, "anti-reflective");
  const arTerm = "(?:anti[- ]?reflect|antireflex|entspiegel|anti-?reflet|antirreflej|antirifless)";
  const layerCount =
    arText.match(new RegExp(`\\b(\\d{1,2})[\\s-]*(?:layers?|fach(?:e[nrs]?)?|couches?|capas|strati)\\b[^.;]{0,24}?${arTerm}`, "i")) ??
    arText.match(new RegExp(`${arTerm}[a-zé]*[^.;]{0,30}?\\(?\\s*(\\d{1,2})\\s*(?:layers?|couches?|capas|strati)\\b`, "i"));
  const layers = Number(layerCount?.[1]);
  if (layers >= 1 && layers <= 20) {
    flags.arLayers = layers;
  } else if (/\banti[- ]reflective\s+(?:coating|coated)\b|\bglare-?proof(?:ed)?\b|\bantireflex|\bentspiegelt|\banti-?reflets?\b|\bantirreflej|\bantirifless/i.test(arText)) {
    flags.arCoated = true;
  }
  // Rolex's Glidelock and Easylink adjust the fit on the wrist without tools.
  if (/\bmicro[- ]?adjust(?:ment)?\b|\bGlidelock\b|\bEasylink\b|\bon[- ]the[- ]fly adjustment clasp\b|\bquick[- ]adjust clasp\b|\bFeinverstellung|\bMikroverstellung|\bmicro-?réglage/i.test(t)) {
    flags.microAdjustClasp = true;
  }
  if (/\bquick[- ]release\b|\bquick[- ]change strap|\bSchnellwechsel|\bdégagement rapide\b|\bliberación rápida\b|\bsgancio rapido\b/i.test(t)) {
    flags.quickRelease = true;
  }

  if (variantTitle) {
    if (/\bbracelet\b/i.test(variantTitle)) flags.braceletIncluded = true;
    else if (/\bstrap\b/i.test(variantTitle)) flags.braceletIncluded = false;
  }
  if (flags.braceletIncluded === undefined && /\b(?:including|includes?)\s+(?:a\s+)?bracelet\b/i.test(t)) {
    flags.braceletIncluded = true;
  }

  return flags;
}

/** A Shopify variant title replaces the page's strap only when it names a
 * strap or bracelet itself; a colourway such as "Granite Black" must not
 * overwrite a stated "Kalbsleder". */
export function variantNamesStrap(variantTitle: string): boolean {
  return /\b(?:bracelet|strap|leather|steel|rubber|nato|mesh|canvas|fkm|silicone|titanium)\b|armband|leder|edelstahl|kautschuk|cuir|acier|caoutchouc|cuero|acero|caucho|pelle|acciaio|gomma/i.test(variantTitle);
}

/** The strap to record, given the Shopify variant title and the strap the page
 * states. Shopify names a product with no options "Default Title", which
 * describes nothing and must never become the strap. */
export function strapFromVariant(variantTitle: string | undefined, statedStrap: string | undefined): string | undefined {
  if (!variantTitle || /^default title$/i.test(variantTitle.trim())) return statedStrap;
  return variantNamesStrap(variantTitle) || !statedStrap ? variantTitle : statedStrap;
}

/** Below this share of SPEC_FIELDS, autofill is labelled partial. */
const PARTIAL_COVERAGE = 0.6;

/** How much of the spec form a scrape filled. A thin result says so rather
 * than presenting blank fields as a complete autofill. */
export function specCoverage(specs: WatchSpecs | undefined): Pick<ScrapeResult, "specsFound" | "specsPossible" | "coverageNote"> {
  const specsPossible = SPEC_FIELDS.length;
  const specsFound = SPEC_FIELDS.filter(({ key }) => {
    const value = specs?.[key];
    return value !== undefined && value !== "";
  }).length;
  return specsFound / specsPossible < PARTIAL_COVERAGE
    ? { specsFound, specsPossible, coverageNote: "partial — page locale or layout limited extraction" }
    : { specsFound, specsPossible };
}

function fallbackTags(text: string, specs: WatchSpecs): string[] {
  const tags: string[] = [];
  if (
    (/\b(?:diver|diving watch|dive watch)\b/i.test(text) || /\buni-directional\s+(?:rotating\s+)?(?:ceramic\s+)?bezel\b/i.test(text)) &&
    (specs.waterResistanceM ?? 0) >= 100
  ) tags.push("diver");
  if (/\bchronograph\b/i.test(text)) tags.push("chronograph");
  if (/\bGMT\b/.test(text)) tags.push("GMT");
  if (/\bworld[ -]?timer\b/i.test(text)) tags.push("worldtimer");
  return tags;
}

export async function scrapeWatch(url: string): Promise<ScrapeResult> {
  const shop = await fromShopify(url).catch(() => null);
  const page = await fetchText(url);
  const html = page.ok && page.body ? page.body : "";
  const base = (page.ok && page.finalUrl) || url;

  const ld = html ? fromJsonLd(html, base) : {};
  const og = html ? fromMeta(html, base) : {};
  const retailerOffer = html ? extractRetailOffer(html, base) : undefined;

  const out: ScrapeResult = { retailer: hostnameOf(base) };

  // A collection landing page contains many product cards and often similarly
  // named families (for example a three-hand Hudson beside a Hudson GMT).
  // Returning fewer fields is safer than attaching one sibling's specs to another.
  const specText = productExtractionText(shop?.bodyHtml, html, isShopifyCollectionUrl(url)).trim();

  const heading = html ? firstHeading(html) : undefined;
  const brand = resolveBrand({ host: hostnameOf(base), vendor: shop?.vendor, ldBrand: ld.brand, pageText: specText });
  const headingIdentifiesProduct = hostnameOf(base) === "spinnaker-watches.com";
  let model =
    headingIdentifiesProduct && heading
      ? [heading, shop?.title && shop.title !== heading ? shop.title : undefined].filter(Boolean).join(" — ")
      : ld.name || shop?.title || og.name;
  if (model && brand && model.toLowerCase().startsWith(brand.toLowerCase())) {
    model = model.slice(brand.length).replace(/^[\s\-–—:|]+/, "").trim();
  }
  if (brand) out.brand = brand.replace(/_/g, " ");
  if (model) out.model = model;
  if (shop?.ref || ld.ref) out.referenceNumber = shop?.ref || ld.ref;

  const price = retailerOffer?.price || ld.price || og.price || shop?.price;
  if (price) {
    out.price = price;
  }
  const condition = inferRetailCondition({
    url: base,
    brand: out.brand,
    explicitCondition: retailerOffer?.condition,
  });
  if (condition) out.condition = condition;

  const image = ld.image || og.image || shop?.image;
  if (image) out.imageUrl = image;

  const extracted = await extractWatchDetails(specText);
  if (extracted) {
    // Structured data (JSON-LD/Shopify/OG) wins for identity fields; the model
    // fills whatever those missed.
    if (!out.brand && extracted.brand) out.brand = extracted.brand;
    if (!out.model && extracted.model) out.model = extracted.model;
    if (!out.referenceNumber && extracted.referenceNumber) out.referenceNumber = extracted.referenceNumber;
    if (Object.keys(extracted.specs).length) out.specs = extracted.specs;
    if (extracted.tags.length) out.tags = normalizeTags(extracted.tags);
    if (extracted.qualityFlags) out.qualityFlags = extracted.qualityFlags;
    if (extracted.friction) out.friction = extracted.friction;
  } else {
    const specs = extractSpecs(specText);
    const strap = strapFromVariant(shop?.variantTitle, specs.braceletStrap);
    if (strap) specs.braceletStrap = strap;
    if (Object.keys(specs).length) out.specs = specs;
    const tags = fallbackTags(specText, specs);
    if (tags.length) out.tags = normalizeTags(tags);
    const qualityFlags = extractQualityFlags(specText, shop?.variantTitle);
    if (Object.keys(qualityFlags).length) out.qualityFlags = qualityFlags;
  }

  if (html || shop) Object.assign(out, specCoverage(out.specs));
  out.foundNothing =
    !out.brand && !out.model && !out.price && !out.imageUrl && !out.specs && !out.tags;
  return out;
}
