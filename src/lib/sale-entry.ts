import { CONDITION_GRADES, MAX_LISTING_PHOTOS, isPhotoDataUrl } from "./listing-shape.mjs";
import { CURRENCIES, type Condition, type ConditionGrade, type ListingContent, type ListingPosting, type Money } from "./types";
import type { FeeLine } from "./proceeds";
import type { SaleClose } from "./private-store";

/**
 * Form fields for the Sell panel, parsed the same way in the browser and the
 * API. Errors are keyed by field so the form can point at them.
 */

export interface FeeField { label: string; amount: string }
export interface PostingField { platform: string; url: string; amount: string; postedAt: string }

export interface ListingFields {
  state: string;
  askingAmount: string;
  currency: string;
  grade: string;
  conditionNotes: string;
  included: string[];
  serviceHistory: string;
  description: string;
  photos: string[];
  postings: PostingField[];
  minimumAmount: string;
  fees: FeeField[];
  /** Ticked: you expect no fees. Unticked with no lines: fees not considered. */
  noFees: boolean;
}

export interface SoldFields {
  amount: string;
  currency: string;
  date: string;
  channel: string;
  countAs: string;
  fees: FeeField[];
  noFees: boolean;
  /** Blank is unknown; 0 is free or buyer-paid shipping. */
  shippingAmount: string;
  buyer: string;
  notes: string;
}

export type FieldErrors = Record<string, string>;

const GRADES = new Set(CONDITION_GRADES.map((grade) => grade.id));
const TEXT_MAX = 4000;
const trim = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function money(raw: string, currency: string, { allowZero = false } = {}): Money | undefined {
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) return undefined;
  return { amount, currency };
}

function parseFees(fees: unknown, noFees: unknown, currency: string, errors: FieldErrors, key: string): FeeLine[] | undefined {
  const lines = Array.isArray(fees) ? fees : [];
  const parsed: FeeLine[] = [];
  lines.forEach((line, index) => {
    const label = trim(line?.label);
    const raw = trim(line?.amount);
    if (!label && !raw) return;
    if (!label) errors[`${key}.${index}`] = "Name this fee, e.g. PayPal or Chrono24.";
    const amount = raw ? money(raw, currency, { allowZero: true }) : undefined;
    if (raw && !amount) errors[`${key}.${index}`] = "Enter an amount of zero or more, or leave it blank if unknown.";
    parsed.push({ label, ...(amount ? { amount } : {}) });
  });
  if (parsed.length) return parsed;
  // No lines: either you said there are none, or fees haven't been considered,
  // which keeps net proceeds unknown.
  return noFees === true ? [] : undefined;
}

export function parseListingFields(input: unknown, today = new Date()):
  | { ok: true; value: { state: "draft" | "live" | "reserved"; content: ListingContent; minimumPrice?: Money; listingFees?: FeeLine[] } }
  | { ok: false; errors: FieldErrors } {
  const data = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof ListingFields, unknown>>;
  const errors: FieldErrors = {};
  const state = trim(data.state);
  if (!["draft", "live", "reserved"].includes(state)) errors.state = "Choose draft, live or reserved.";
  const currency = trim(data.currency).toUpperCase();
  if (!CURRENCIES.includes(currency)) errors.currency = "Choose a supported currency.";
  const askingPrice = money(trim(data.askingAmount), currency);
  if (!askingPrice) errors.askingAmount = "Enter an asking price greater than zero.";
  const grade = trim(data.grade);
  if (!GRADES.has(grade)) errors.grade = "Choose a condition grade.";

  const text = (key: keyof ListingFields) => {
    const value = trim(data[key]);
    if (value.length > TEXT_MAX) errors[key] = `Keep it under ${TEXT_MAX} characters.`;
    return value || undefined;
  };
  const conditionNotes = text("conditionNotes");
  const serviceHistory = text("serviceHistory");
  const description = text("description");
  const included = (Array.isArray(data.included) ? data.included : []).map(trim).filter(Boolean);

  const photos = (Array.isArray(data.photos) ? data.photos : []).filter((photo): photo is string => typeof photo === "string");
  if (photos.length > MAX_LISTING_PHOTOS) errors.photos = `Use at most ${MAX_LISTING_PHOTOS} photos.`;
  else if (photos.some((photo) => photo.startsWith("data:") && !isPhotoDataUrl(photo))) errors.photos = "One of the photos couldn't be read. Remove it and add it again.";
  // Published listings sell a used watch on its own photos (validation repeats
  // this). Drafts may be saved without any.
  if (state !== "draft" && !errors.state && photos.length === 0) errors.photos = "Add at least one of your own photos before publishing.";

  const postings: ListingPosting[] = [];
  (Array.isArray(data.postings) ? data.postings : []).forEach((posting, index) => {
    const platform = trim(posting?.platform);
    const url = trim(posting?.url);
    const raw = trim(posting?.amount);
    const postedAt = trim(posting?.postedAt) || today.toISOString().slice(0, 10);
    if (!platform && !url && !raw) return;
    if (!platform) errors[`postings.${index}`] = "Name the platform.";
    else if (url && !/^https?:\/\//.test(url)) errors[`postings.${index}`] = "The link must start with http:// or https://.";
    else if (raw && !money(raw, currency)) errors[`postings.${index}`] = "Enter the posted price, or leave it blank.";
    else if (!isDay(postedAt)) errors[`postings.${index}`] = "Use a date like 2026-10-10.";
    const askingPrice = raw ? money(raw, currency) : undefined;
    postings.push({ platform, ...(url ? { url } : {}), ...(askingPrice ? { askingPrice } : {}), postedAt });
  });

  const minimumRaw = trim(data.minimumAmount);
  const minimumPrice = minimumRaw ? money(minimumRaw, currency) : undefined;
  if (minimumRaw && !minimumPrice) errors.minimumAmount = "Enter a minimum greater than zero, or leave it blank.";
  else if (minimumPrice && askingPrice && minimumPrice.amount > askingPrice.amount) errors.minimumAmount = "Your minimum is above the asking price.";
  const listingFees = parseFees(data.fees, data.noFees, currency, errors, "fees");

  if (Object.keys(errors).length) return { ok: false, errors };
  const content: ListingContent = {
    askingPrice: askingPrice!,
    grade: grade as ConditionGrade,
    included,
    photos,
    ...(conditionNotes ? { conditionNotes } : {}),
    ...(serviceHistory ? { serviceHistory } : {}),
    ...(description ? { description } : {}),
    ...(postings.length ? { postings } : {}),
  };
  return {
    ok: true,
    value: {
      state: state as "draft" | "live" | "reserved",
      content,
      ...(minimumPrice ? { minimumPrice } : {}),
      ...(listingFees ? { listingFees } : {}),
    },
  };
}

export function parseSoldFields(input: unknown, today = new Date()):
  | { ok: true; value: { price: Money; date: string; channel: string; countAs: Condition; close: SaleClose } }
  | { ok: false; errors: FieldErrors } {
  const data = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof SoldFields, unknown>>;
  const errors: FieldErrors = {};
  const currency = trim(data.currency).toUpperCase();
  if (!CURRENCIES.includes(currency)) errors.currency = "Choose a supported currency.";
  const price = money(trim(data.amount), currency);
  if (!price) errors.amount = "Enter the sale price, greater than zero.";
  const date = trim(data.date);
  if (!isDay(date)) errors.date = "Use a date like 2026-10-10.";
  else if (date > today.toISOString().slice(0, 10)) errors.date = "The sale date can't be in the future.";
  const channel = trim(data.channel);
  if (!channel) errors.channel = "Where did it sell? e.g. Chrono24, r/Watchexchange, direct.";
  const countAs = trim(data.countAs);
  if (countAs !== "new" && countAs !== "pre-owned") errors.countAs = "Choose how this sale counts as market evidence.";

  const fees = parseFees(data.fees, data.noFees, currency, errors, "fees");
  // Closing a sale is when the costs are known. "Not considered" isn't an
  // answer here: list them (blank amount if unknown) or say there were none.
  if (fees === undefined && !Object.keys(errors).some((key) => key.startsWith("fees"))) errors.fees = "Add the fees (leave an amount blank if unknown), or tick \"No fees\".";
  const shippingRaw = trim(data.shippingAmount);
  const shipping = shippingRaw ? money(shippingRaw, currency, { allowZero: true }) : undefined;
  if (shippingRaw && !shipping) errors.shippingAmount = "Enter zero or more, or leave it blank if unknown.";
  const buyer = trim(data.buyer);
  const notes = trim(data.notes);
  if (notes.length > TEXT_MAX) errors.notes = `Keep it under ${TEXT_MAX} characters.`;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      price: price!,
      date,
      channel,
      countAs: countAs as Condition,
      close: { fees: fees ?? [], ...(shipping ? { shipping } : {}), ...(buyer ? { buyer } : {}), ...(notes ? { notes } : {}) },
    },
  };
}
