// The sale-listing shape, condition scale and its checks, in one place.
//
// Plain .mjs for the same reason as spec-ranges.mjs: the app's validator
// (validation.ts), the private store and scripts/validate-data.mjs — which
// runs under bare Node — all need the same rules. See
// docs/briefs/11-selling-first-slice.md.

/**
 * How worn the watch is, for a buyer. Separate from the market-evidence
 * Condition ("new" | "pre-owned"), which describes where a price came from.
 * Ordered best first; each grade carries the one-line definition a listing
 * shows, so "very good" means the same thing on every listing.
 */
export const CONDITION_GRADES = [
  { id: "unworn", label: "Unworn", definition: "Never worn; stickers or protective film may remain." },
  { id: "excellent", label: "Excellent", definition: "Lightly worn, with no marks visible at arm's length." },
  { id: "very-good", label: "Very good", definition: "Light hairlines from normal wear; no dings or dents." },
  { id: "good", label: "Good", definition: "Visible wear and a few small marks; works as it should." },
  { id: "fair", label: "Fair", definition: "Heavy wear or cosmetic damage; works, and priced to match." },
];

const GRADE_IDS = new Set(CONDITION_GRADES.map((grade) => grade.id));

/** Suggestions for the "included" checklist. Free text is allowed too. */
export const COMMON_INCLUSIONS = ["Box", "Papers / warranty card", "Extra links", "Extra strap", "Manual", "Hang tag"];

/** A published listing's states. A draft is never published: it lives in
 * data/private.json until it goes live, so it can't reach git or Pages. */
export const LISTING_STATES = ["live", "reserved"];

export const MAX_LISTING_PHOTOS = 12;
// Photos arrive downscaled to 1000px JPEG by the browser (~150 KB); this cap
// only stops a pasted original from bloating private.json.
export const MAX_PHOTO_DATA_URL_LENGTH = 3_000_000;
const TEXT_MAX = 4000;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Where a published photo lives, relative to public/ (and to the Pages base). */
export function publishedPhotoPattern(watchId) {
  const id = String(watchId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^listings/${id}/[a-f0-9]{16}\\.(jpg|png|webp)$`);
}

export function isPhotoDataUrl(value) {
  return typeof value === "string" && value.length <= MAX_PHOTO_DATA_URL_LENGTH && DATA_URL.test(value);
}

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isDate = (value) => typeof value === "string" && !Number.isNaN(new Date(value).getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value);

function moneyErrors(value, path, currencies, { required = true } = {}) {
  if (value === undefined && !required) return [];
  if (!isRecord(value) || typeof value.amount !== "number" || !(value.amount > 0) || !currencies.has(value.currency)) {
    return [`${path} must be a positive amount in a supported currency`];
  }
  return [];
}

function optionalText(value, path) {
  if (value === undefined) return [];
  return typeof value === "string" && value.length <= TEXT_MAX ? [] : [`${path} must be text under ${TEXT_MAX} characters`];
}

/**
 * Errors for listing content (everything but state and dates).
 *
 * @param {unknown} value
 * @param {string} path
 * @param {{ currencies: Set<string>, photos: "published" | "draft", watchId?: string }} options
 *   Published photos are paths under public/listings/<id>/; draft photos are
 *   data URLs, because a draft must not write anything git would pick up.
 */
export function listingContentErrors(value, path, { currencies, photos, watchId }) {
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors = [...moneyErrors(value.askingPrice, `${path}.askingPrice`, currencies)];
  if (!GRADE_IDS.has(value.grade)) errors.push(`${path}.grade must be one of ${[...GRADE_IDS].join(", ")}`);
  errors.push(...optionalText(value.conditionNotes, `${path}.conditionNotes`));
  errors.push(...optionalText(value.serviceHistory, `${path}.serviceHistory`));
  errors.push(...optionalText(value.description, `${path}.description`));

  if (!Array.isArray(value.included) || value.included.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${path}.included must be a list of items`);
  }

  if (!Array.isArray(value.photos)) {
    errors.push(`${path}.photos must be a list`);
  } else {
    if (value.photos.length > MAX_LISTING_PHOTOS) errors.push(`${path}.photos holds at most ${MAX_LISTING_PHOTOS}`);
    const pattern = photos === "published" ? publishedPhotoPattern(watchId ?? "") : undefined;
    value.photos.forEach((photo, index) => {
      const ok = photos === "published" ? typeof photo === "string" && pattern.test(photo) : isPhotoDataUrl(photo);
      if (!ok) {
        errors.push(photos === "published"
          ? `${path}.photos[${index}] must be a file under listings/${watchId}/ (your own photo, saved by the listing editor)`
          : `${path}.photos[${index}] must be an image data URL`);
      }
    });
  }

  if (value.postings !== undefined) {
    if (!Array.isArray(value.postings)) errors.push(`${path}.postings must be a list`);
    else value.postings.forEach((posting, index) => {
      const at = `${path}.postings[${index}]`;
      if (!isRecord(posting)) return errors.push(`${at} must be an object`);
      if (typeof posting.platform !== "string" || !posting.platform.trim()) errors.push(`${at}.platform is required`);
      if (posting.url !== undefined && (typeof posting.url !== "string" || !/^https?:\/\//.test(posting.url))) errors.push(`${at}.url must be an http(s) URL`);
      errors.push(...moneyErrors(posting.askingPrice, `${at}.askingPrice`, currencies, { required: false }));
      if (!isDate(posting.postedAt)) errors.push(`${at}.postedAt must be a date`);
    });
  }
  return errors;
}

/** Errors for a published listing on a watch in watches.json. */
export function publishedListingErrors(value, path, { currencies, watchId, status }) {
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors = [];
  if (status !== "owned") errors.push(`${path} is only allowed on an owned watch; a sold watch's listing is closed`);
  if (!LISTING_STATES.includes(value.state)) errors.push(`${path}.state must be one of ${LISTING_STATES.join(", ")}`);
  if (!isDate(value.listedAt)) errors.push(`${path}.listedAt must be a date`);
  errors.push(...listingContentErrors(value, path, { currencies, photos: "published", watchId }));
  // A used watch is sold on its own photos; a shop's marketing image can't
  // stand in, and a live listing without any is not ready.
  if (Array.isArray(value.photos) && value.photos.length === 0) errors.push(`${path} needs at least one of your own photos to be published`);
  return errors;
}

/** Errors for fee lines. An amount left out means unknown, never zero. */
export function feeLineErrors(value, path, currencies) {
  if (!Array.isArray(value)) return [`${path} must be a list`];
  return value.flatMap((line, index) => {
    const at = `${path}[${index}]`;
    if (!isRecord(line)) return [`${at} must be an object`];
    const errors = [];
    if (typeof line.label !== "string" || !line.label.trim()) errors.push(`${at}.label is required`);
    if (line.amount !== undefined && (!isRecord(line.amount) || typeof line.amount.amount !== "number" || line.amount.amount < 0 || !currencies.has(line.amount.currency))) {
      errors.push(`${at}.amount must be zero or more in a supported currency`);
    }
    return errors;
  });
}
