import { CURRENCIES, type Money } from "./types";

/** What you paid for a watch. Private: it lives in data/private.json, never in
 * watches.json, because the repo and the Pages export are both public. */
export interface PrivatePurchase {
  price: Money;
  /** YYYY-MM-DD. */
  date?: string;
  /** Where it was bought, e.g. "Brand site" or "r/Watchexchange". */
  source?: string;
}

export interface PurchaseFields {
  amount: string;
  currency: string;
  date: string;
  source: string;
}
export type PurchaseErrors = Partial<Record<keyof PurchaseFields, string>>;

const SOURCE_MAX = 120;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Shared by the inline editor and the API. The price is required: a purchase
 * with only a date can't answer "what did I pay", which is its whole job.
 * Clearing is a separate, explicit request, as with targets. */
export function parsePurchaseFields(input: unknown, today: Date = new Date()):
  | { ok: true; purchase: PrivatePurchase }
  | { ok: false; errors: PurchaseErrors } {
  const data = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const text = (key: keyof PurchaseFields) => typeof data[key] === "string" ? (data[key] as string).trim() : "";
  const raw = text("amount");
  const amount = Number(raw);
  const currency = text("currency").toUpperCase();
  const date = text("date");
  const source = text("source");
  const errors: PurchaseErrors = {};
  if (!raw || !Number.isFinite(amount) || amount <= 0) errors.amount = "Enter what you paid, greater than zero.";
  if (!CURRENCIES.includes(currency)) errors.currency = "Choose a supported currency.";
  if (date && !isCalendarDate(date)) errors.date = "Use a date like 2026-03-14.";
  else if (date && date > today.toISOString().slice(0, 10)) errors.date = "The purchase date can't be in the future.";
  if (source.length > SOURCE_MAX) errors.source = `Keep it under ${SOURCE_MAX} characters.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    purchase: { price: { amount, currency }, ...(date ? { date } : {}), ...(source ? { source } : {}) },
  };
}

/** A stale draft must not overwrite a purchase changed in another tab. */
export function purchaseRevision(purchase?: PrivatePurchase): string {
  return JSON.stringify([purchase?.price.amount ?? null, purchase?.price.currency ?? "", purchase?.date ?? "", purchase?.source ?? ""]);
}

/** Validate a stored purchase read back from private.json. Returns the errors
 * rather than throwing so the store can name the file and watch id. */
export function purchaseRecordErrors(value: unknown, path: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
  const record = value as Record<string, unknown>;
  const price = record.price as Record<string, unknown> | undefined;
  const errors: string[] = [];
  if (!price || typeof price !== "object" || typeof price.amount !== "number" || !(price.amount > 0) || typeof price.currency !== "string" || !CURRENCIES.includes(price.currency)) {
    errors.push(`${path}.price must be a positive amount in a supported currency`);
  }
  if (record.date !== undefined && (typeof record.date !== "string" || !isCalendarDate(record.date))) errors.push(`${path}.date must be YYYY-MM-DD`);
  if (record.source !== undefined && typeof record.source !== "string") errors.push(`${path}.source must be text`);
  return errors;
}
