import { promises as fs } from "fs";
import path from "path";
import { IS_STATIC } from "./config";
import { purchaseRecordErrors, purchaseRevision, type PrivatePurchase } from "./purchase-entry";
import { feeLineErrors, listingContentErrors } from "./listing-shape.mjs";
import { CURRENCIES, type ListingContent, type Money } from "./types";
import type { FeeLine } from "./proceeds";

/**
 * Seller-private data: what you paid now, and later your minimum, buyer and
 * fees (docs/briefs/11-selling-first-slice.md). The repo is public and the
 * Pages export ships page data to the browser, so none of this may live in
 * watches.json. data/private.json is git-ignored and exists only on the
 * machine running the local server — back it up separately.
 *
 * Pages read it beside the watch rather than merged into it: a Watch object
 * flows into client components and the static export, and keeping private
 * fields off that type means they can't ride along by accident.
 */
export interface PrivateWatchRecord {
  purchase?: PrivatePurchase;
  /** A listing not yet published. Photos are data URLs, so a draft writes
   * nothing git would see; publishing moves it into watches.json. */
  listingDraft?: ListingContent;
  /** The lowest price you'd accept. Never shown on Pages. */
  minimumPrice?: Money;
  /** Fees you expect on the sale, for the net-at-ask estimate. */
  listingFees?: FeeLine[];
  /** Filled by "mark sold". The price and date are public on the watch. */
  saleClose?: SaleClose;
}

export interface SaleClose {
  buyer?: string;
  /** Empty means you said there were none; an amount left out is unknown. */
  fees: FeeLine[];
  /** Undefined is unknown; zero is free or buyer-paid shipping. */
  shipping?: Money;
  notes?: string;
}

/** Keyed by watch id. */
export type PrivateRecords = Record<string, PrivateWatchRecord>;

// Resolved per call, not at module load, so tests that mock process.cwd()
// see their temp directory.
function privatePath(): string {
  return path.join(process.cwd(), "data", "private.json");
}

let writeQueue: Promise<void> = Promise.resolve();

const CURRENCY_SET = new Set(CURRENCIES);

function isMoney(value: unknown, min: number): boolean {
  const money = value as Money | undefined;
  return Boolean(money) && typeof money!.amount === "number" && money!.amount >= min && CURRENCY_SET.has(money!.currency);
}
const isPositiveMoney = (value: unknown) => isMoney(value, Number.MIN_VALUE);

export class PurchaseConflictError extends Error {}

function validate(data: unknown): PrivateRecords {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("data/private.json must contain an object keyed by watch id");
  }
  const errors: string[] = [];
  for (const [id, record] of Object.entries(data as Record<string, unknown>)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(`${id} must be an object`);
      continue;
    }
    const r = record as Record<string, unknown>;
    if (r.purchase !== undefined) errors.push(...purchaseRecordErrors(r.purchase, `${id}.purchase`));
    if (r.listingDraft !== undefined) errors.push(...listingContentErrors(r.listingDraft, `${id}.listingDraft`, { currencies: CURRENCY_SET, photos: "draft" }));
    if (r.minimumPrice !== undefined && !isPositiveMoney(r.minimumPrice)) errors.push(`${id}.minimumPrice must be a positive amount in a supported currency`);
    if (r.listingFees !== undefined) errors.push(...feeLineErrors(r.listingFees, `${id}.listingFees`, CURRENCY_SET));
    if (r.saleClose !== undefined) {
      const close = r.saleClose as Record<string, unknown> | null;
      if (!close || typeof close !== "object") errors.push(`${id}.saleClose must be an object`);
      else {
        errors.push(...feeLineErrors(close.fees, `${id}.saleClose.fees`, CURRENCY_SET));
        if (close.shipping !== undefined && !isMoney(close.shipping, 0)) errors.push(`${id}.saleClose.shipping must be zero or more`);
      }
    }
  }
  if (errors.length) throw new Error(`data/private.json is invalid:\n- ${errors.join("\n- ")}`);
  return data as PrivateRecords;
}

/** A missing file is an empty store, not an error: most checkouts (CI, Pages)
 * never have one. The static build never reads it even when it exists. */
export async function getPrivateRecords(): Promise<PrivateRecords> {
  if (IS_STATIC) return {};
  try {
    return validate(JSON.parse(await fs.readFile(privatePath(), "utf-8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function getPrivateRecord(id: string): Promise<PrivateWatchRecord | undefined> {
  return (await getPrivateRecords())[id];
}

async function saveAll(records: PrivateRecords): Promise<void> {
  validate(records);
  const file = privatePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmpPath = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(records, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, file);
}

/** Set or clear one watch's purchase. `undefined` clears it; a record left
 * with nothing in it is removed so the file doesn't collect empty entries. */
export async function savePurchase(id: string, purchase: PrivatePurchase | undefined, expectedRevision: string): Promise<PrivatePurchase | undefined> {
  await updatePrivateRecord(id, (current) => {
    if (purchaseRevision(current?.purchase) !== expectedRevision) {
      throw new PurchaseConflictError("This purchase changed elsewhere. Cancel and reopen it to review the latest value.");
    }
    return { ...current, purchase };
  });
  return purchase;
}

/**
 * Replace one watch's private record inside the write queue. Fields set to
 * undefined are dropped, and a record left empty is removed, so the file
 * doesn't collect blank entries. `change` may throw to refuse the write.
 */
export async function updatePrivateRecord(
  id: string,
  change: (current: PrivateWatchRecord | undefined) => PrivateWatchRecord,
): Promise<PrivateWatchRecord | undefined> {
  const run = writeQueue.then(async () => {
    if (IS_STATIC) throw new Error("Private data can't be written in the static build.");
    const records = await getPrivateRecords();
    const next = Object.fromEntries(
      Object.entries(change(records[id])).filter(([, value]) => value !== undefined),
    ) as PrivateWatchRecord;
    if (Object.keys(next).length) records[id] = next;
    else delete records[id];
    await saveAll(records);
    return records[id];
  });
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}
