import { SPEC_FIELDS } from "./specs";
import { plausibilityIssues } from "./spec-plausibility.mjs";
import { publishedListingErrors } from "./listing-shape.mjs";
import {
  Availability,
  AVAILABILITY_STATES,
  Condition,
  CURRENCIES,
  Friction,
  Money,
  MOVEMENT_TYPES,
  PriceSnapshot,
  QualityFlags,
  RetailerLink,
  ScoringCategory,
  SCORING_CATEGORIES,
  SoldComp,
  Watch,
  WatchInput,
  WatchSpecs,
  WatchStatus,
  WATCH_STATUSES,
  WishlistTier,
  WISHLIST_TIERS,
} from "./types";

type RecordValue = Record<string, unknown>;

type ValidationResult<T> =
  /**
   * `warnings` carries plausibility problems that must not block the write.
   * The add form's URL autofill is where most bad values came from in the
   * first place, and rejecting a half-scraped record would lose the good
   * fields with the bad. npm run validate:data is the gate that actually
   * refuses them, so nothing implausible reaches a commit.
   */
  | { ok: true; data: T; warnings: string[] }
  | { ok: false; errors: string[] };

export class DataValidationError extends Error {
  constructor(message: string, readonly errors: string[]) {
    super(message);
    this.name = "DataValidationError";
  }
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cleanOptionalString(value: unknown, path: string, errors: string[]): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
    return undefined;
  }
  return value.trim() || undefined;
}

function cleanRequiredString(value: unknown, path: string, errors: string[]): string | undefined {
  const cleaned = cleanOptionalString(value, path, errors);
  if (!cleaned) errors.push(`${path} is required`);
  return cleaned;
}

function cleanPositiveNumber(value: unknown, path: string, errors: string[]): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    errors.push(`${path} must be a positive number`);
    return undefined;
  }
  return number;
}

function cleanNonNegativeNumber(value: unknown, path: string, errors: string[]): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    errors.push(`${path} must be a non-negative number`);
    return undefined;
  }
  return number;
}

function cleanBoolean(value: unknown, path: string, errors: string[]): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
    return undefined;
  }
  return value;
}

function cleanIntegerRange(
  value: unknown,
  path: string,
  errors: string[],
  min: number,
  max: number
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    errors.push(`${path} must be a whole number from ${min} to ${max}`);
    return undefined;
  }
  return number;
}

function cleanCurrency(value: unknown, path: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} is required`);
    return undefined;
  }
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push(`${path} must be a 3-letter currency code`);
    return undefined;
  }
  return currency;
}

function cleanMoney(value: unknown, path: string, errors: string[]): Money | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  const amount = cleanPositiveNumber(value.amount, `${path}.amount`, errors);
  const currency = cleanCurrency(value.currency, `${path}.currency`, errors);
  return amount !== undefined && currency ? { amount, currency } : undefined;
}

function cleanStatus(value: unknown, required: boolean, errors: string[]): WatchStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return required ? "wishlist" : undefined;
  }
  if (typeof value !== "string" || !WATCH_STATUSES.includes(value as WatchStatus)) {
    errors.push(`status must be one of ${WATCH_STATUSES.join(", ")}`);
    return undefined;
  }
  return value as WatchStatus;
}

function cleanWishlistTier(value: unknown, errors: string[]): WishlistTier | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !WISHLIST_TIERS.includes(value as WishlistTier)) {
    errors.push(`wishlistTier must be one of ${WISHLIST_TIERS.join(", ")}`);
    return undefined;
  }
  return value as WishlistTier;
}

function cleanScoringCategory(value: unknown, errors: string[]): ScoringCategory | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !SCORING_CATEGORIES.includes(value as ScoringCategory)) {
    errors.push(`scoringCategory must be one of ${SCORING_CATEGORIES.join(", ")}`);
    return undefined;
  }
  return value as ScoringCategory;
}

function cleanCondition(value: unknown, path: string, errors: string[]): Condition | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value !== "new" && value !== "pre-owned") {
    errors.push(`${path} must be new or pre-owned`);
    return undefined;
  }
  return value;
}

function cleanLinks(value: unknown, required: boolean, errors: string[]): RetailerLink[] | undefined {
  if (value === undefined || value === null) return required ? [] : undefined;
  if (!Array.isArray(value)) {
    errors.push("links must be an array");
    return undefined;
  }

  return value.flatMap((item, index) => {
    const path = `links[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`);
      return [];
    }

    const url = cleanRequiredString(item.url, `${path}.url`, errors);
    if (!url) return [];

    const link: RetailerLink = { url };
    const retailer = cleanOptionalString(item.retailer, `${path}.retailer`, errors);
    const price = cleanMoney(item.price, `${path}.price`, errors);
    const condition = cleanCondition(item.condition, `${path}.condition`, errors);
    const observedAt = cleanDateString(item.observedAt, `${path}.observedAt`, errors);
    const askHistory = cleanPriceHistory(item.askHistory, errors, `${path}.askHistory`);

    if (retailer) link.retailer = retailer;
    if (price) link.price = price;
    if (condition) link.condition = condition;
    if (observedAt) link.observedAt = observedAt;
    if (askHistory?.length) link.askHistory = askHistory;
    return [link];
  });
}

/**
 * Sold comps, all-or-nothing per entry. Unlike a retailer link — where a bare
 * URL is still useful — a sale without price, condition, date and source
 * cannot be read later, so an incomplete entry is an error rather than a
 * partial record.
 */
function cleanSoldComps(value: unknown, errors: string[]): SoldComp[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    errors.push("soldComps must be an array");
    return undefined;
  }

  return value.flatMap((item, index) => {
    const path = `soldComps[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`);
      return [];
    }

    const price = cleanMoney(item.price, `${path}.price`, errors);
    if (!price) {
      errors.push(`${path}.price is required`);
      return [];
    }
    const condition = cleanCondition(item.condition, `${path}.condition`, errors);
    if (!condition) {
      errors.push(`${path}.condition is required`);
      return [];
    }
    const soldAt = cleanDateString(item.soldAt, `${path}.soldAt`, errors);
    if (!soldAt) {
      errors.push(`${path}.soldAt is required`);
      return [];
    }
    const source = cleanRequiredString(item.source, `${path}.source`, errors);
    if (!source) return [];

    const comp: SoldComp = { price, condition, soldAt, source };
    const url = cleanOptionalString(item.url, `${path}.url`, errors);
    const notes = cleanOptionalString(item.notes, `${path}.notes`, errors);
    if (url) comp.url = url;
    if (notes) comp.notes = notes;
    return [comp];
  });
}

// Also validates a link's askHistory, which follows the same moves-only rule.
function cleanPriceHistory(value: unknown, errors: string[], field = "priceHistory"): PriceSnapshot[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return undefined;
  }

  const history = value.flatMap((item, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`);
      return [];
    }

    const price = cleanMoney(item.price, `${path}.price`, errors);
    if (!price) {
      errors.push(`${path}.price is required`);
      return [];
    }
    const date = cleanDateString(item.date, `${path}.date`, errors);
    if (!date) {
      errors.push(`${path}.date is required`);
      return [];
    }

    const snapshot: PriceSnapshot = { price, date };
    const source = cleanOptionalString(item.source, `${path}.source`, errors);
    if (source) snapshot.source = source;
    return [snapshot];
  });

  // The series is meant to be a list of moves, oldest first. Catching an
  // out-of-order or duplicated entry here keeps every consumer free to treat
  // the last element as "current" without re-sorting or de-duplicating.
  for (let i = 1; i < history.length; i++) {
    if (new Date(history[i].date).getTime() < new Date(history[i - 1].date).getTime()) {
      errors.push(`${field}[${i}].date is earlier than the entry before it`);
    }
    if (
      history[i].price.amount === history[i - 1].price.amount &&
      history[i].price.currency === history[i - 1].price.currency
    ) {
      errors.push(`${field}[${i}] repeats the previous price; the series records moves only`);
    }
  }

  return history;
}

function cleanSpecs(value: unknown, required: boolean, errors: string[]): WatchSpecs | undefined {
  if (value === undefined || value === null) return required ? {} : undefined;
  if (!isRecord(value)) {
    errors.push("specs must be an object");
    return undefined;
  }

  const specs: WatchSpecs = {};
  for (const field of SPEC_FIELDS) {
    const raw = value[field.key];
    if (raw === undefined || raw === null || raw === "") continue;

    if (field.type === "number") {
      const number = cleanPositiveNumber(raw, `specs.${String(field.key)}`, errors);
      if (number !== undefined) (specs[field.key] as number) = number;
      continue;
    }

    const text = cleanOptionalString(raw, `specs.${String(field.key)}`, errors);
    if (!text) continue;

    if (field.key === "movement" && !MOVEMENT_TYPES.includes(text as typeof MOVEMENT_TYPES[number])) {
      errors.push(`specs.movement must be one of ${MOVEMENT_TYPES.join(", ")}`);
      continue;
    }

    (specs[field.key] as string) = text;
  }
  return specs;
}

function cleanQualityFlags(value: unknown, errors: string[]): QualityFlags | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    errors.push("qualityFlags must be an object");
    return undefined;
  }

  const flags: QualityFlags = {};
  const numbers: Array<{ key: "regulatedPositions" | "accuracySpecSpd" | "hardenedCoatingHv" | "antimagneticAm" | "arLayers"; integer?: boolean }> = [
    { key: "regulatedPositions", integer: true },
    { key: "accuracySpecSpd" },
    { key: "hardenedCoatingHv" },
    { key: "antimagneticAm" },
    { key: "arLayers", integer: true },
  ];
  for (const { key, integer } of numbers) {
    const cleaned = cleanNonNegativeNumber(value[key], `qualityFlags.${key}`, errors);
    if (cleaned === undefined) continue;
    if (integer && !Number.isInteger(cleaned)) {
      errors.push(`qualityFlags.${key} must be a whole number`);
      continue;
    }
    flags[key] = cleaned;
  }

  const booleans = [
    "sapphireBezelInsert",
    "ceramicBezelInsert",
    "drilledLugs",
    "microAdjustClasp",
    "quickRelease",
    "braceletIncluded",
    "arCoated",
  ] as const;
  for (const key of booleans) {
    const cleaned = cleanBoolean(value[key], `qualityFlags.${key}`, errors);
    if (cleaned !== undefined) flags[key] = cleaned;
  }

  return flags;
}

function cleanFriction(value: unknown, errors: string[]): Friction | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    errors.push("friction must be an object");
    return undefined;
  }

  const availability = value.availability;
  if (typeof availability !== "string" || !AVAILABILITY_STATES.includes(availability as Availability)) {
    errors.push(`friction.availability must be one of ${AVAILABILITY_STATES.join(", ")}`);
  }
  const brandLiquidity = cleanIntegerRange(value.brandLiquidity, "friction.brandLiquidity", errors, 1, 5);
  if (brandLiquidity === undefined) {
    errors.push("friction.brandLiquidity is required");
  }
  const expectedShipDate = cleanDateString(value.expectedShipDate, "friction.expectedShipDate", errors);
  const braceletUpchargeUsd = cleanNonNegativeNumber(
    value.braceletUpchargeUsd,
    "friction.braceletUpchargeUsd",
    errors
  );

  if (
    typeof availability !== "string" ||
    !AVAILABILITY_STATES.includes(availability as Availability) ||
    brandLiquidity === undefined
  ) {
    return undefined;
  }

  const friction: Friction = {
    availability: availability as Availability,
    brandLiquidity: brandLiquidity as Friction["brandLiquidity"],
  };
  if (expectedShipDate) friction.expectedShipDate = expectedShipDate;
  if (braceletUpchargeUsd !== undefined) friction.braceletUpchargeUsd = braceletUpchargeUsd;
  return friction;
}

function cleanTags(value: unknown, required: boolean, errors: string[]): string[] | undefined {
  if (value === undefined || value === null) return required ? [] : undefined;
  if (!Array.isArray(value)) {
    errors.push("tags must be an array");
    return undefined;
  }

  const tags: string[] = [];
  value.forEach((item, index) => {
    const tag = cleanOptionalString(item, `tags[${index}]`, errors);
    if (tag) tags.push(tag);
  });
  return Array.from(new Set(tags));
}

function cleanDateString(value: unknown, path: string, errors: string[]): string | undefined {
  const date = cleanOptionalString(value, path, errors);
  if (!date) return undefined;
  if (Number.isNaN(new Date(date).getTime())) {
    errors.push(`${path} must be a valid date`);
    return undefined;
  }
  return date;
}

function cleanTransaction(
  value: unknown,
  path: string,
  errors: string[]
): { price?: Money; date?: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  const price = cleanMoney(value.price, `${path}.price`, errors);
  const date = cleanDateString(value.date, `${path}.date`, errors);
  return price || date ? { ...(price ? { price } : {}), ...(date ? { date } : {}) } : undefined;
}

function cleanSale(value: unknown, errors: string[]): Watch["sale"] | undefined {
  const base = cleanTransaction(value, "sale", errors);
  if (!isRecord(value)) return base;
  const channel = cleanOptionalString(value.channel, "sale.channel", errors);
  return base || channel ? { ...base, ...(channel ? { channel } : {}) } : undefined;
}

function assignIfPresent<T extends RecordValue, K extends keyof WatchInput>(
  target: Partial<WatchInput>,
  source: T,
  key: string,
  value: WatchInput[K] | undefined
) {
  if (hasOwn(source, key)) {
    (target as Record<string, unknown>)[key] = value;
  }
}

/**
 * Plausibility problems in a spec block, as human-readable strings.
 *
 * Both severities are returned here. On the write path everything is advisory:
 * the distinction between "cannot be right" and "unlikely" only decides which
 * of them fails npm run validate:data.
 */
export function specPlausibilityWarnings(specs: WatchSpecs | undefined): string[] {
  return plausibilityIssues(specs).map((issue: { message: string }) => issue.message);
}

export function normalizeWatchInput(body: unknown): ValidationResult<WatchInput> {
  return normalizeWatchShape(body, false) as ValidationResult<WatchInput>;
}

export function normalizeWatchPatch(body: unknown): ValidationResult<Partial<WatchInput>> {
  return normalizeWatchShape(body, true);
}

/**
 * `listing` is accepted only when reading the stored collection. Through the
 * add/edit API it is refused: publishing writes photo files and moves a draft
 * out of private.json, which only the Sell panel's route (sale-store.ts) does.
 */
function normalizeWatchShape(
  body: unknown,
  partial: boolean,
  stored?: { id: string }
): ValidationResult<WatchInput | Partial<WatchInput>> {
  const errors: string[] = [];
  if (!isRecord(body)) return { ok: false, errors: ["body must be an object"] };

  const output: Partial<WatchInput> = {};

  if (!partial || hasOwn(body, "brand")) {
    assignIfPresent(output, body, "brand", cleanRequiredString(body.brand, "brand", errors));
  }
  if (!partial || hasOwn(body, "model")) {
    assignIfPresent(output, body, "model", cleanRequiredString(body.model, "model", errors));
  }

  assignIfPresent(output, body, "referenceNumber", cleanOptionalString(body.referenceNumber, "referenceNumber", errors));
  assignIfPresent(output, body, "status", cleanStatus(body.status, !partial, errors));
  assignIfPresent(output, body, "wishlistTier", cleanWishlistTier(body.wishlistTier, errors));
  assignIfPresent(output, body, "scoringCategory", cleanScoringCategory(body.scoringCategory, errors));
  // Like listing: kept when reading the stored file, refused through the
  // add/edit API, because only the finalist route enforces the cap.
  if (hasOwn(body, "finalist") && body.finalist !== undefined && body.finalist !== null) {
    if (!stored) errors.push("finalist is set from the Finalist toggle, which enforces the limit; it can't be edited here");
    else if (body.finalist !== true) errors.push("finalist must be true when present");
    else output.finalist = true;
  }
  assignIfPresent(output, body, "designUniqueness", cleanIntegerRange(body.designUniqueness, "designUniqueness", errors, 1, 5));
  assignIfPresent(output, body, "designPreferenceElo", cleanNonNegativeNumber(body.designPreferenceElo, "designPreferenceElo", errors));
  assignIfPresent(output, body, "designComparisonCount", cleanIntegerRange(body.designComparisonCount, "designComparisonCount", errors, 0, Number.MAX_SAFE_INTEGER));
  assignIfPresent(output, body, "personalFit", cleanIntegerRange(body.personalFit, "personalFit", errors, 1, 5));
  assignIfPresent(output, body, "price", cleanMoney(body.price, "price", errors));
  assignIfPresent(output, body, "priceUpdatedAt", cleanDateString(body.priceUpdatedAt, "priceUpdatedAt", errors));
  assignIfPresent(output, body, "priceHistory", cleanPriceHistory(body.priceHistory, errors));
  assignIfPresent(output, body, "targetPrice", cleanMoney(body.targetPrice, "targetPrice", errors));
  assignIfPresent(output, body, "landedPrice", cleanMoney(body.landedPrice, "landedPrice", errors));
  assignIfPresent(output, body, "qualityFlags", cleanQualityFlags(body.qualityFlags, errors));
  assignIfPresent(output, body, "friction", cleanFriction(body.friction, errors));
  assignIfPresent(output, body, "links", cleanLinks(body.links, !partial, errors));
  assignIfPresent(output, body, "soldComps", cleanSoldComps(body.soldComps, errors));
  assignIfPresent(output, body, "imageUrl", cleanOptionalString(body.imageUrl, "imageUrl", errors));
  assignIfPresent(output, body, "specs", cleanSpecs(body.specs, !partial, errors));
  assignIfPresent(output, body, "tags", cleanTags(body.tags, !partial, errors));
  assignIfPresent(output, body, "notes", cleanOptionalString(body.notes, "notes", errors));
  // Private: the purchase panel writes data/private.json instead. Rejected
  // rather than dropped, so a caller learns its value went nowhere.
  if (hasOwn(body, "purchase")) errors.push("purchase is private; record it in the What you paid panel, which saves it outside watches.json");
  assignIfPresent(output, body, "sale", cleanSale(body.sale, errors));
  if (hasOwn(body, "listing") && body.listing !== undefined && body.listing !== null) {
    if (!stored) {
      errors.push("listing is set from the Sell panel, which publishes its photos; it can't be edited here");
    } else {
      const listingErrors = publishedListingErrors(body.listing, "listing", {
        currencies: new Set(CURRENCIES),
        watchId: stored.id,
        status: body.status,
      });
      if (listingErrors.length) errors.push(...listingErrors);
      else output.listing = body.listing as WatchInput["listing"];
    }
  }

  if (!partial) {
    output.brand ??= "";
    output.model ??= "";
    output.status ??= "wishlist";
    output.links ??= [];
    output.specs ??= {};
    output.tags ??= [];
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    data: output as WatchInput | Partial<WatchInput>,
    warnings: specPlausibilityWarnings(output.specs),
  };
}

export function validateWatchCollection(value: unknown): Watch[] {
  if (!Array.isArray(value)) {
    throw new DataValidationError("Watch data must be an array.", ["data/watches.json must contain an array"]);
  }

  const errors: string[] = [];
  const ids = new Set<string>();
  const watches: Watch[] = [];

  value.forEach((item, index) => {
    const path = `watches[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`);
      return;
    }

    const id = cleanRequiredString(item.id, `${path}.id`, errors);
    if (id) {
      if (ids.has(id)) errors.push(`${path}.id duplicates ${id}`);
      ids.add(id);
    }

    const dateAdded = cleanDateString(item.dateAdded, `${path}.dateAdded`, errors);
    const result = normalizeWatchShape(item, false, { id: typeof item.id === "string" ? item.id : "" }) as ValidationResult<WatchInput>;
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `${path}.${error}`));
      return;
    }
    if (id && dateAdded) {
      watches.push({ ...result.data, id, dateAdded });
    }
  });

  if (errors.length) {
    throw new DataValidationError("Watch data is invalid.", errors);
  }

  return watches;
}

