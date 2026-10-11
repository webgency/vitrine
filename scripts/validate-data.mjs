#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { publishedListingErrors } from "../src/lib/listing-shape.mjs";
import { sellerErrors } from "../src/lib/seller-shape.mjs";
import { alertStateErrors } from "../src/lib/alerts.mjs";
import { SPEC_RANGES, inSpecRange } from "../src/lib/spec-ranges.mjs";
import { plausibilityIssues } from "../src/lib/spec-plausibility.mjs";
import {
  CURRENCY_TO_USD,
  RATES_AS_OF,
  RATES_STALE_AFTER_DAYS,
  ratesAgeDays,
  ratesAreStale,
} from "../src/lib/currency-rates.mjs";

const DATA_URL = new URL("../data/watches.json", import.meta.url);

const STATUSES = new Set(["wishlist", "owned", "sold"]);
// Matches WISHLIST_TIERS in src/lib/types.ts. The six older tiers were migrated
// to these three; an old value is an error, not something to accept quietly.
const WISHLIST_TIERS = new Set(["shortlist", "watching", "pass"]);
const MOVEMENTS = new Set(["automatic", "manual", "quartz", "spring-drive", "solar", "kinetic", "other"]);
const CONDITIONS = new Set(["new", "pre-owned"]);
const SCORING_CATEGORIES = new Set(["diver", "chronograph", "gmt", "dress", "sports"]);
// Derived from the shared table rather than restated, so adding a currency in
// one place cannot leave the validator warning about a rate that now exists.
const KNOWN_CURRENCIES = new Set(Object.keys(CURRENCY_TO_USD));

const SPEC_TYPES = {
  caseDiameterMm: "number",
  caseThicknessMm: "number",
  lugToLugMm: "number",
  lugWidthMm: "number",
  caseMaterial: "string",
  movement: "movement",
  caliber: "string",
  powerReserveHours: "number",
  waterResistanceM: "number",
  crystal: "string",
  dialColor: "string",
  braceletStrap: "string",
  complications: "string",
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkString(value, path, errors, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (typeof value !== "string") errors.push(`${path} must be a string`);
}

function checkDate(value, path, errors, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    errors.push(`${path} must be a valid date string`);
  }
}

function checkPositiveNumber(value, path, errors, { required = false, integer = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${path} must be a positive number`);
    return;
  }
  if (integer && !Number.isInteger(value)) errors.push(`${path} must be a whole number`);
}

function checkIntegerRange(value, path, errors, { required = false, min = 1, max = 5 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${path} must be a whole number from ${min} to ${max}`);
  }
}

function checkMoney(value, path, errors) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  checkPositiveNumber(value.amount, `${path}.amount`, errors, { required: true });
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) {
    errors.push(`${path}.currency must be a 3-letter currency code`);
  } else if (!KNOWN_CURRENCIES.has(value.currency)) {
    warnings.push(`${path}.currency ${value.currency} is not in the known currency list; scoring will use its fallback rate.`);
  }
}

function checkPriceHistory(value, path, errors) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((snapshot, index) => {
    const snapshotPath = `${path}[${index}]`;
    if (!isRecord(snapshot)) {
      errors.push(`${snapshotPath} must be an object`);
      return;
    }
    if (snapshot.price === undefined || snapshot.price === null) {
      errors.push(`${snapshotPath}.price is required`);
    } else {
      checkMoney(snapshot.price, `${snapshotPath}.price`, errors);
    }
    checkDate(snapshot.date, `${snapshotPath}.date`, errors, { required: true });
    checkString(snapshot.source, `${snapshotPath}.source`, errors);

    // Oldest first, moves only — the invariant every reader relies on when it
    // treats the last entry as the current price.
    const previous = value[index - 1];
    if (index > 0 && isRecord(previous) && isRecord(previous.price) && isRecord(snapshot.price)) {
      if (new Date(snapshot.date).getTime() < new Date(previous.date).getTime()) {
        errors.push(`${snapshotPath}.date is earlier than the entry before it`);
      }
      if (
        snapshot.price.amount === previous.price.amount &&
        snapshot.price.currency === previous.price.currency
      ) {
        errors.push(`${snapshotPath} repeats the previous price; the series records moves only`);
      }
    }
  });
}

function checkLinks(value, path, errors, warnings = []) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((link, index) => {
    const linkPath = `${path}[${index}]`;
    if (!isRecord(link)) {
      errors.push(`${linkPath} must be an object`);
      return;
    }
    checkString(link.url, `${linkPath}.url`, errors, { required: true });
    checkString(link.retailer, `${linkPath}.retailer`, errors);
    checkMoney(link.price, `${linkPath}.price`, errors);
    if (link.condition !== undefined && !CONDITIONS.has(link.condition)) {
      errors.push(`${linkPath}.condition must be new or pre-owned`);
    }
    checkDate(link.observedAt, `${linkPath}.observedAt`, errors);
    checkPriceHistory(link.askHistory, `${linkPath}.askHistory`, errors);

    // Same gap check as the watch-level priceHistory below: a trail that ends
    // somewhere other than the current ask was hand-edited on one side only.
    const newest = Array.isArray(link.askHistory) && link.askHistory.length
      ? link.askHistory[link.askHistory.length - 1]
      : undefined;
    if (newest && isRecord(newest.price) && isRecord(link.price)) {
      if (newest.price.amount !== link.price.amount || newest.price.currency !== link.price.currency) {
        warnings.push(
          `${linkPath}.askHistory ends at ${newest.price.amount} ${newest.price.currency} but price is ${link.price.amount} ${link.price.currency}; the latest move was not recorded.`
        );
      }
    }
  });
}

// Solds are hand-entered, so every field that makes one readable later is
// required here. The app's write path applies the same rule.
function checkSoldComps(value, path, errors) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((comp, index) => {
    const compPath = `${path}[${index}]`;
    if (!isRecord(comp)) {
      errors.push(`${compPath} must be an object`);
      return;
    }
    // checkMoney tolerates an absent price; for a sold comp it is required.
    if (comp.price === undefined || comp.price === null) errors.push(`${compPath}.price is required`);
    checkMoney(comp.price, `${compPath}.price`, errors);
    if (!CONDITIONS.has(comp.condition)) errors.push(`${compPath}.condition must be new or pre-owned`);
    checkDate(comp.soldAt, `${compPath}.soldAt`, errors, { required: true });
    checkString(comp.source, `${compPath}.source`, errors, { required: true });
    checkString(comp.url, `${compPath}.url`, errors);
    checkString(comp.notes, `${compPath}.notes`, errors);
  });
}

function checkSpecs(value, path, errors, warnings) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const [key, type] of Object.entries(SPEC_TYPES)) {
    const specPath = `${path}.${key}`;
    const specValue = value[key];
    if (specValue === undefined || specValue === null || specValue === "") continue;
    if (type === "number") checkPositiveNumber(specValue, specPath, errors);
    else if (type === "movement" && !MOVEMENTS.has(specValue)) errors.push(`${specPath} must be a known movement type`);
    else if (type === "string") checkString(specValue, specPath, errors);
  }
  checkSpecPlausibility(value, path, errors, warnings);
}

/**
 * The same physical bounds sanitizeSpecs applies to incoming data, enforced
 * against what is already on disk. sanitizeSpecs only runs on scraped and
 * backfilled values, so a swapped or duplicated measurement entering by any
 * other path used to sit in the file unnoticed and quietly distort scoring —
 * a 15mm case diameter with a 15.5mm thickness, for instance.
 *
 * The per-field ranges live in spec-ranges.mjs; the rules that compare fields
 * against each other live in spec-plausibility.mjs, shared with the write path
 * so both judge a record the same way. Warn-level rules never fail the run.
 */
function checkSpecPlausibility(specs, path, errors, warnings) {
  for (const key of Object.keys(SPEC_RANGES)) {
    const value = specs[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (!inSpecRange(key, value)) {
      const [min, max] = SPEC_RANGES[key];
      errors.push(`${path}.${key} is ${value}, outside the plausible range ${min}-${max}`);
    }
  }

  for (const issue of plausibilityIssues(specs)) {
    const line = `${path} ${issue.message}`;
    if (issue.severity === "error") errors.push(line);
    else warnings.push(line);
  }
}

function checkTags(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((tag, index) => checkString(tag, `${path}[${index}]`, errors, { required: true }));
}

function checkTransaction(value, path, errors) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  checkMoney(value.price, `${path}.price`, errors);
  checkDate(value.date, `${path}.date`, errors);
}

const errors = [];
const warnings = [];
const ids = new Set();
const listingPhotos = [];
const watches = JSON.parse(await readFile(DATA_URL, "utf8"));

if (!Array.isArray(watches)) {
  errors.push("data/watches.json must contain an array");
} else {
  watches.forEach((watch, index) => {
    const path = `watches[${index}]`;
    if (!isRecord(watch)) {
      errors.push(`${path} must be an object`);
      return;
    }

    checkString(watch.id, `${path}.id`, errors, { required: true });
    if (watch.id) {
      if (ids.has(watch.id)) errors.push(`${path}.id duplicates ${watch.id}`);
      ids.add(watch.id);
    }
    checkString(watch.brand, `${path}.brand`, errors, { required: true });
    checkString(watch.model, `${path}.model`, errors, { required: true });
    checkString(watch.referenceNumber, `${path}.referenceNumber`, errors);
    if (!STATUSES.has(watch.status)) errors.push(`${path}.status must be wishlist, owned, or sold`);
    if (watch.wishlistTier !== undefined && !WISHLIST_TIERS.has(watch.wishlistTier)) {
      errors.push(`${path}.wishlistTier must be one of ${Array.from(WISHLIST_TIERS).join(", ")}`);
    }
    if (watch.finalist !== undefined) {
      if (watch.finalist !== true) errors.push(`${path}.finalist must be true when present; unpinning removes it`);
      else if (watch.status !== "wishlist" || watch.wishlistTier === "pass") {
        errors.push(`${path}.finalist is only for wishlist watches not marked Pass`);
      }
    }
    if (watch.scoringCategory !== undefined && !SCORING_CATEGORIES.has(watch.scoringCategory)) {
      errors.push(`${path}.scoringCategory must be one of ${Array.from(SCORING_CATEGORIES).join(", ")}`);
    }
    checkIntegerRange(watch.designUniqueness, `${path}.designUniqueness`, errors);
    checkIntegerRange(watch.personalFit, `${path}.personalFit`, errors);
    if (watch.designPreferenceElo !== undefined && (!Number.isFinite(watch.designPreferenceElo) || watch.designPreferenceElo < 0)) {
      errors.push(`${path}.designPreferenceElo must be a non-negative number`);
    }
    checkIntegerRange(watch.designComparisonCount, `${path}.designComparisonCount`, errors, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    checkMoney(watch.price, `${path}.price`, errors);
    checkDate(watch.priceUpdatedAt, `${path}.priceUpdatedAt`, errors);
    checkPriceHistory(watch.priceHistory, `${path}.priceHistory`, errors);
    checkMoney(watch.targetPrice, `${path}.targetPrice`, errors);
    checkLinks(watch.links, `${path}.links`, errors, warnings);
    checkSoldComps(watch.soldComps, `${path}.soldComps`, errors);

    // A history whose newest entry disagrees with the tracked price means one
    // of the two was hand-edited without the other. Not fatal — the price is
    // still the source of truth — but the series has a gap worth knowing about.
    const newest = Array.isArray(watch.priceHistory) && watch.priceHistory.length
      ? watch.priceHistory[watch.priceHistory.length - 1]
      : undefined;
    if (newest && isRecord(newest.price) && isRecord(watch.price)) {
      if (newest.price.amount !== watch.price.amount || newest.price.currency !== watch.price.currency) {
        warnings.push(
          `${path}.priceHistory ends at ${newest.price.amount} ${newest.price.currency} but price is ${watch.price.amount} ${watch.price.currency}; the latest move was not recorded.`
        );
      }
    }
    checkString(watch.imageUrl, `${path}.imageUrl`, errors);
    checkSpecs(watch.specs, `${path}.specs`, errors, warnings);
    checkTags(watch.tags, `${path}.tags`, errors);
    checkString(watch.notes, `${path}.notes`, errors);
    checkDate(watch.dateAdded, `${path}.dateAdded`, errors, { required: true });
    // What you paid is private (data/private.json, git-ignored). This file is
    // public in the repo and the Pages export, so a purchase here is a leak.
    if (watch.purchase !== undefined) {
      errors.push(`${path}.purchase is private; move it to data/private.json via the What you paid panel`);
    }
    checkTransaction(watch.sale, `${path}.sale`, errors);
    checkString(watch.sale?.channel, `${path}.sale.channel`, errors);
    if (watch.listing !== undefined) {
      errors.push(...publishedListingErrors(watch.listing, `${path}.listing`, { currencies: KNOWN_CURRENCIES, watchId: watch.id, status: watch.status }));
      for (const photo of Array.isArray(watch.listing?.photos) ? watch.listing.photos : []) {
        if (typeof photo === "string") listingPhotos.push({ photo, at: `${path}.listing.photos` });
      }
    }
  });
}

// Stale rates only matter if something actually needs converting. A collection
// priced entirely in USD is unaffected by drift, so staying quiet there keeps
// the warning meaningful when it does appear.
const foreignCurrencies = new Set();
// Same cap as MAX_FINALISTS in src/lib/finalists.ts (finalists.test.ts checks
// they agree); this script runs under bare Node and can't import the .ts.
const MAX_FINALISTS = 5;
const finalistCount = Array.isArray(watches) ? watches.filter((watch) => watch?.finalist === true).length : 0;
if (finalistCount > MAX_FINALISTS) errors.push(`${finalistCount} finalists; at most ${MAX_FINALISTS} are allowed`);

for (const watch of watches) {
  const monies = [
    watch.price,
    watch.landedPrice,
    watch.targetPrice,
    ...(watch.links ?? []).map((link) => link.price),
    ...(watch.priceHistory ?? []).map((snapshot) => snapshot.price),
  ];
  for (const money of monies) {
    if (isRecord(money) && typeof money.currency === "string" && money.currency !== "USD") {
      foreignCurrencies.add(money.currency);
    }
  }
}

if (foreignCurrencies.size && ratesAreStale()) {
  const age = ratesAgeDays();
  warnings.push(
    `Exchange rates in src/lib/currency-rates.mjs are ${age} days old (taken ${RATES_AS_OF}, stale after ${RATES_STALE_AFTER_DAYS}). ` +
      `${foreignCurrencies.size} non-USD currenc${foreignCurrencies.size === 1 ? "y is" : "ies are"} in use (${[...foreignCurrencies].sort().join(", ")}), ` +
      `so scoring converts at rates that have had time to drift across a price band. Refresh with: curl -s "https://api.frankfurter.dev/v1/latest?base=USD"`
  );
}

// A published listing points at photo files the Sell panel wrote under
// public/; a missing file would show a broken image on Pages.
for (const { photo, at } of listingPhotos) {
  try {
    await access(new URL(`../public/${photo}`, import.meta.url));
  } catch {
    errors.push(`${at} references public/${photo}, which does not exist`);
  }
}

// Seller contact is optional until something is listed.
try {
  errors.push(...sellerErrors(JSON.parse(await readFile(new URL("../data/seller.json", import.meta.url), "utf8"))));
} catch (error) {
  if (error?.code !== "ENOENT") errors.push(`data/seller.json could not be read: ${error.message}`);
  else if (Array.isArray(watches) && watches.some((watch) => watch?.listing?.state === "live")) {
    warnings.push("A listing is live but data/seller.json is missing, so the For-sale page has no way to contact you.");
  }
}

// The alert log is optional until the first alert fires. When present, it gets
// the same shape check the app applies before reading or writing it.
try {
  const alerts = JSON.parse(await readFile(new URL("../data/alerts.json", import.meta.url), "utf8"));
  errors.push(...alertStateErrors(alerts));
} catch (error) {
  if (error?.code !== "ENOENT") errors.push(`data/alerts.json could not be read: ${error.message}`);
}

if (warnings.length) {
  console.warn(`Watch data validation completed with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length) {
  console.error(`Watch data validation failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const statuses = watches.reduce((acc, watch) => {
  acc[watch.status] = (acc[watch.status] ?? 0) + 1;
  return acc;
}, {});
const priced = watches.filter((watch) => watch.price).length;

console.log(`Watch data OK: ${watches.length} watches, ${priced} priced, statuses ${JSON.stringify(statuses)}`);
