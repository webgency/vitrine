#!/usr/bin/env node
// Enrich data/watches.json with price + image scraped from each watch's
// retailer links. Zero dependencies (uses Node 18+ global fetch).
//
// IMPORTANT: run this where there is real outbound network access — i.e. a
// LOCAL Claude Code / terminal session on your own machine. The cloud sandbox
// (Claude Code on the web, even when viewed through the desktop app) routes
// outbound traffic through an egress proxy that blocks retailer domains, so
// every fetch there returns 403 and nothing will be found.
//
// Usage:
//   node scripts/enrich-watches.mjs           # fetch + write (skips fields already set)
//   node scripts/enrich-watches.mjs --dry     # report only, write nothing
//   node scripts/enrich-watches.mjs --refresh # refresh dated link asks + record headline moves
//   node scripts/enrich-watches.mjs --force   # overwrite existing price/imageUrl
//   node scripts/enrich-watches.mjs --id=foo  # only this watch id (repeatable)
//   node scripts/enrich-watches.mjs --verbose # show per-link failures
//
// Price history accumulates only from runs that actually re-read a price, so
// use --refresh on a schedule if you want a series to build up. Refresh also
// checks every retailer link and dates only asks actually read from that link;
// the default run fills headline gaps and will never observe a move. When a
// link's ask has changed, refresh also appends it to that link's askHistory;
// an unchanged ask only advances observedAt.

import { readFile, writeFile } from "node:fs/promises";
import { readAlertState, writeAlertState } from "../src/lib/alert-file.mjs";
import { appendAlerts, detectAlerts } from "../src/lib/alerts.mjs";
import { mergeRefreshed } from "../src/lib/refresh-merge.mjs";
import { recordAskMove } from "../src/lib/listing-history.mjs";
import { recordOfferObservation } from "../src/lib/offer-observation.mjs";
import {
  extractRetailOffer,
  inferRetailCondition,
  offerFailure,
} from "../src/lib/retailer-offer.mjs";

const DATA_URL = new URL("../data/watches.json", import.meta.url);
const ALERTS_URL = new URL("../data/alerts.json", import.meta.url);

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const FORCE = args.includes("--force");
const REFRESH = args.includes("--refresh");
const ALLOW_CURRENCY_CHANGE = args.includes("--allow-currency-change");
const VERBOSE = args.includes("--verbose");

/**
 * Set the tracked price and record the move in priceHistory. Mirrors
 * appendSnapshot in src/lib/price-history.ts — the series records moves only,
 * so re-reading an unchanged price leaves the history alone and keeps its
 * existing date, which is what makes that date mean "unchanged since".
 *
 * Returns true when the price actually moved.
 */
function recordPrice(watch, price, source) {
  const observedAt = new Date().toISOString();
  const current = watch.price;

  // A scrape that returns a different currency is not a price change, it is a
  // change of units: several watches are stored as pre-converted USD, and
  // rewriting them to the retailer's native currency silently rescores them
  // through the hardcoded CURRENCY_TO_USD rates. That moved one watch across a
  // price band and so changed the rubric it was judged against. Skip by
  // default; --allow-currency-change opts in.
  if (current && current.currency !== price.currency && !ALLOW_CURRENCY_CHANGE) {
    return "currency";
  }

  const moved = !current || current.amount !== price.amount || current.currency !== price.currency;

  // Compare against the tracked price, NOT against the tail of priceHistory.
  // Comparing against the series meant a watch with no history recorded every
  // scrape as a move, stamping a price that had been stable for months as
  // "first seen today" and destroying what the dates mean.
  if (!moved) {
    watch.priceUpdatedAt = observedAt;
    return false;
  }

  let history = Array.isArray(watch.priceHistory) ? watch.priceHistory : [];
  // Seed the outgoing price so the first recorded move shows what it moved
  // from, dated to when that price was last known. Mirrors updateWatch.
  if (!history.length && current) {
    history = [{ price: current, date: watch.priceUpdatedAt ?? watch.dateAdded, source: "manual" }];
  }

  watch.price = price;
  watch.priceUpdatedAt = observedAt;
  watch.priceHistory = [...history, { price, date: observedAt, source }];
  return true;
}
const ONLY = args.filter((a) => a.startsWith("--id=")).map((a) => a.slice(5));

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const SYMBOL_TO_ISO = {
  "US$": "USD", "A$": "AUD", "AU$": "AUD", "C$": "CAD", "CA$": "CAD",
  $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₣": "CHF",
};

async function fetchText(url, { json = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: json
          ? "application/json,*/*"
          : "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: await res.text(), finalUrl: res.url };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Parse a price string like "$5,400.00", "€1.490", "GBP 1,200" -> { amount, currency? }.
function parseMoney(raw, fallbackCurrency) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let currency = fallbackCurrency;
  const code = s.match(/\b(USD|EUR|GBP|JPY|CHF|AUD|CAD|SEK|NOK|DKK|HKD|SGD|NZD)\b/i);
  if (code) currency = code[1].toUpperCase();
  else {
    for (const [sym, iso] of Object.entries(SYMBOL_TO_ISO)) {
      if (s.includes(sym)) { currency = iso; break; }
    }
  }

  let num = s.replace(/[^0-9.,]/g, "");
  if (!num) return null;
  if (num.includes(",") && num.includes(".")) {
    // Whichever separator comes last is the decimal point.
    num = num.lastIndexOf(",") > num.lastIndexOf(".")
      ? num.replace(/\./g, "").replace(",", ".")
      : num.replace(/,/g, "");
  } else if (num.includes(",")) {
    num = /,\d{2}$/.test(num) ? num.replace(",", ".") : num.replace(/,/g, "");
  }
  const amount = Number(num);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency };
}

function absolutize(u, base) {
  if (!u) return undefined;
  try { return new URL(u, base).href.replace(/^http:/, "https:"); } catch { return undefined; }
}

function extractFromJsonLd(html, baseUrl) {
  const out = {};
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const nodes = [];
    const push = (d) => d && typeof d === "object" && nodes.push(d);
    if (Array.isArray(data)) data.forEach(push);
    else { push(data); if (Array.isArray(data["@graph"])) data["@graph"].forEach(push); }

    for (const node of nodes) {
      const type = node["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      if (!out.image) {
        let img = node.image;
        if (Array.isArray(img)) img = img[0];
        if (img && typeof img === "object") img = img.url || img.contentUrl;
        if (typeof img === "string") out.image = absolutize(img, baseUrl);
      }
      if (!out.price) {
        let offers = node.offers;
        if (Array.isArray(offers)) offers = offers[0];
        if (offers && typeof offers === "object") {
          const m = parseMoney(offers.price ?? offers.lowPrice ?? offers.highPrice, offers.priceCurrency);
          if (m) out.price = m;
        }
      }
    }
  }
  return out;
}

function metaContent(html, names) {
  for (const n of names) {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i"));
    if (a) return a[1];
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, "i"));
    if (b) return b[1];
  }
  return undefined;
}

function extractFromMeta(html, baseUrl) {
  const out = {};
  const img = metaContent(html, ["og:image:secure_url", "og:image", "twitter:image"]);
  if (img) out.image = absolutize(img, baseUrl);
  const m = parseMoney(
    metaContent(html, ["product:price:amount", "og:price:amount", "price"]),
    metaContent(html, ["product:price:currency", "og:price:currency", "priceCurrency"])
  );
  if (m) out.price = m;
  return out;
}

// Shopify exposes a clean product JSON at <origin>/products/<handle>.json.
async function tryShopify(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const productsIndex = parts.indexOf("products");
  const handle = productsIndex >= 0 ? parts[productsIndex + 1] : undefined;
  if (!handle) return null;
  const prefix = parts.slice(0, productsIndex).join("/");
  const jsonUrl = `${parsed.origin}/${prefix ? `${prefix}/` : ""}products/${handle}.json`;
  const r = await fetchText(jsonUrl, { json: true });
  if (!r.ok) return null;
  let data;
  try { data = JSON.parse(r.body); } catch { return null; }
  const p = data.product;
  if (!p) return null;
  const out = { source: "shopify" };
  let requestedVariant = null;
  try { requestedVariant = new URL(url).searchParams.get("variant"); } catch { /* use availability fallback */ }
  const variant = (p.variants || []).find((v) => requestedVariant && String(v.id) === requestedVariant)
    || (p.variants || []).find((v) => v.available)
    || (p.variants || [])[0];
  if (variant?.price != null) out.price = parseMoney(String(variant.price)); // currency unknown here
  const image = variant?.featured_image || (p.images || [])[0];
  if (image?.src) out.image = absolutize(image.src, parsed.origin);
  return out;
}

async function enrichLink(url) {
  const result = (await tryShopify(url).catch(() => null)) || {};

  const page = await fetchText(url);
  if (page.ok) {
    const base = page.finalUrl || url;
    const retailOffer = extractRetailOffer(page.body, base);
    const ld = extractFromJsonLd(page.body, base);
    const meta = extractFromMeta(page.body, base);
    result.image = result.image || ld.image || meta.image;
    result.price = result.price || retailOffer?.price || ld.price || meta.price;
    result.condition = retailOffer?.condition;
    // Backfill currency for a Shopify amount that came without one.
    if (result.price && !result.price.currency) {
      result.price.currency = retailOffer?.price?.currency || ld.price?.currency || meta.price?.currency;
    }
    result.source = result.source || retailOffer?.source || (ld.price || ld.image ? "json-ld" : meta.price || meta.image ? "og-meta" : undefined);
  } else if (!result.price && !result.image) {
    return { error: page.status ? `HTTP ${page.status}` : page.error };
  }

  if (result.price && !result.price.currency) {
    delete result.price;
    result.priceError = {
      code: "missing-price-currency",
      message: "found an amount but no page-stated currency; refusing to assume USD",
    };
  } else if (!result.price) {
    result.priceError = offerFailure(url);
  }
  return result;
}

const short = (s, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function main() {
  const watches = JSON.parse(await readFile(DATA_URL, "utf8"));
  const targets = ONLY.length ? watches.filter((w) => ONLY.includes(w.id)) : watches;
  // Alerts fire on change, so keep each watch as it stood before this run.
  const before = new Map(watches.map((w) => [w.id, structuredClone(w)]));

  let priceN = 0, offerN = 0, askMoveN = 0, imageN = 0, changed = 0;
  const misses = [];
  const currencySkips = [];
  const offerCurrencyChanges = [];

  for (const w of targets) {
    const name = `${w.brand} ${w.model}`;
    const needPrice = FORCE || REFRESH || !w.price;
    const needImage = FORCE || !w.imageUrl;
    if (!needPrice && !needImage) { if (VERBOSE) console.log(`· skip  ${name}`); continue; }

    let gotPrice = null;
    let gotImage = null;
    const observedAt = new Date().toISOString();
    let watchOfferN = 0;
    let watchMoveN = 0;
    const refreshedConditions = new Set();
    const linkFailures = [];
    const links = w.links || [];
    for (const [index, link] of links.entries()) {
      const r = await enrichLink(link.url);
      if (r && (r.price || r.image)) {
        if (r.price && !gotPrice) gotPrice = r;
        if (r.image && !gotImage) gotImage = r;

        // A retailer observation belongs only to the exact URL that returned
        // it. Never copy the headline watch price into links: deal scoring
        // relies on each link being independent, dated market evidence.
        if (REFRESH && r.price) {
          const condition = inferRetailCondition({
            url: link.url,
            brand: w.brand,
            explicitCondition: r.condition,
          });
          const before = { price: link.price, observedAt: link.observedAt, askHistory: link.askHistory };
          const result = recordOfferObservation(link, r.price, observedAt, {
            condition,
          });
          const priorMoves = before.askHistory?.length ?? 0;
          if ((recordAskMove(before, link, observedAt, "scrape").askHistory?.length ?? 0) > priorMoves) {
            askMoveN++;
            watchMoveN++;
          }
          if (result === "currency-updated") {
            offerCurrencyChanges.push(
              `${name} (${short(link.url, 36)}): retailer ask stored as ${r.price.amount} ${r.price.currency}`,
            );
          }
          offerN++;
          watchOfferN++;
          refreshedConditions.add(link.condition || "condition unknown");
        }

        // The default gap-filling pass keeps its original first-result
        // behavior. An explicit refresh checks every link so best-offer and
        // deal evidence can be refreshed independently.
        if (!REFRESH && (!needPrice || gotPrice) && (!needImage || gotImage)) break;
      }
      if (r?.error || r?.priceError) {
        const failure = r.error
          ? { code: "fetch-failed", message: r.error }
          : r.priceError;
        linkFailures.push(`[${failure.code}] ${failure.message}`);
        if (VERBOSE || ONLY.length) {
          console.log(`    ${short(link.url, 48)} -> [${failure.code}] ${failure.message}`);
        }
      }
      if (index < links.length - 1) {
        await new Promise((res) => setTimeout(res, 250)); // be polite between hosts
      }
    }

    if (!gotPrice && !gotImage) {
      misses.push(name);
      const reason = linkFailures.length ? ` — ${Array.from(new Set(linkFailures)).join("; ")}` : "";
      console.log(`✗ miss  ${name}${reason}`);
      continue;
    }
    const did = [];
    if (needPrice && gotPrice?.price) {
      const result = recordPrice(w, gotPrice.price, "scrape");
      if (result === "currency") {
        currencySkips.push(`${name}: stored ${w.price.amount} ${w.price.currency}, site quotes ${gotPrice.price.amount} ${gotPrice.price.currency}`);
      } else {
        priceN++;
        did.push(result ? `${gotPrice.price.amount} ${gotPrice.price.currency}` : `${gotPrice.price.amount} ${gotPrice.price.currency} (unchanged)`);
      }
    }
    if (needImage && gotImage?.image) { w.imageUrl = gotImage.image; imageN++; did.push("image"); }
    if (watchOfferN) {
      did.push(`${watchOfferN} dated offer${watchOfferN === 1 ? "" : "s"} (${Array.from(refreshedConditions).join("/")})`);
    }
    if (watchMoveN) did.push(`${watchMoveN} ask move${watchMoveN === 1 ? "" : "s"}`);
    if (did.length) {
      changed++;
      const source = gotPrice?.source || gotImage?.source || "?";
      console.log(`✓ ${String(source).padEnd(19)}${name.padEnd(34)} ${did.join(", ")}`);
    }
    else {
      misses.push(name);
      const reason = linkFailures.length ? ` — ${Array.from(new Set(linkFailures)).join("; ")}` : " (nothing usable)";
      console.log(`✗ miss  ${name}${reason}`);
    }
  }

  console.log(`\nPrices: ${priceN}  ·  Dated offers: ${offerN}  ·  Ask moves: ${askMoveN}  ·  Images: ${imageN}  ·  Watches changed: ${changed}/${targets.length}`);
  if (misses.length) console.log(`Missing (${misses.length}): ${misses.map((m) => short(m, 22)).join("; ")}`);
  if (currencySkips.length) {
    console.log(`\nHeadline prices preserved — site quotes a different currency (${currencySkips.length}).`);
    console.log(`Native retailer asks were still recorded on their exact links. Use --allow-currency-change to update tracked headlines too:`);
    for (const skip of currencySkips) console.log(`  · ${skip}`);
  }
  if (offerCurrencyChanges.length) {
    console.log(`\nRetailer asks moved from stored conversions to page-native currency (${offerCurrencyChanges.length}):`);
    for (const change of offerCurrencyChanges) console.log(`  · ${change}`);
  }

  // Write onto the file as it is now, not as this run read it: the run takes
  // minutes, and an edit saved in the app meanwhile must survive it.
  let output = watches;
  const skipped = new Set();
  if (!DRY && changed) {
    const merged = mergeRefreshed(JSON.parse(await readFile(DATA_URL, "utf8")), before, watches);
    output = merged.watches;
    for (const id of merged.skipped) skipped.add(id);
    if (skipped.size) {
      console.log(`\nEdited during this run, so left as edited (refreshed next run): ${output.filter((w) => skipped.has(w.id)).map((w) => short(`${w.brand} ${w.model}`, 30)).join("; ")}`);
    }
  }
  const written = new Set(output.map((w) => w.id));

  // Same rules as an edit in the app. A dry run lists what would fire and
  // records nothing. A watch whose refresh was dropped announces nothing.
  const alertState = await readAlertState(ALERTS_URL);
  const alertNow = new Date();
  const candidates = targets
    .filter((w) => written.has(w.id) && !skipped.has(w.id))
    .flatMap((w) => detectAlerts(before.get(w.id), w, { now: alertNow, events: alertState.events }));
  const { state: nextAlertState, added: newAlerts } = appendAlerts(alertState, candidates, alertNow);
  if (newAlerts.length) {
    console.log(`\n${DRY ? "Would record" : "Alerts"} (${newAlerts.length}):`);
    for (const alert of newAlerts) {
      console.log(`  · ${alert.type} ${alert.payload.watch}: ${alert.payload.price.amount} ${alert.payload.price.currency}${alert.payload.source ? ` from ${alert.payload.source}` : ""}`);
    }
  }

  if (DRY) return console.log("\n--dry: nothing written.");
  if (changed) {
    await writeFile(DATA_URL, JSON.stringify(output, null, 2) + "\n");
    console.log("\nWrote data/watches.json — review with: git diff data/watches.json");
    if (newAlerts.length) {
      await writeAlertState(ALERTS_URL, nextAlertState);
      console.log("Wrote data/alerts.json");
    }
  } else {
    console.log("\nNo changes; file untouched.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
