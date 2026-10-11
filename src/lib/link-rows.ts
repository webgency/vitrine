import type { RetailerLink } from "./types";

/** A retailer link as the edit form holds it: strings, one per input. */
export interface LinkRow {
  url: string;
  retailer: string;
  priceAmount: string;
  priceCurrency: string;
  condition: RetailerLink["condition"] | "";
  /** The date input's value, YYYY-MM-DD. */
  observedAt: string;
  /**
   * The stored timestamp the row was loaded with. The date input can only hold
   * a day, so without this every form save cut "2026-10-10T15:56:08.146Z" to
   * "2026-10-10" on every link, including ones nobody touched.
   */
  storedObservedAt?: string;
}

export function emptyLinkRow(): LinkRow {
  return { url: "", retailer: "", priceAmount: "", priceCurrency: "USD", condition: "", observedAt: "" };
}

export function toLinkRow(link: RetailerLink): LinkRow {
  return {
    url: link.url,
    retailer: link.retailer ?? "",
    priceAmount: link.price?.amount != null ? String(link.price.amount) : "",
    priceCurrency: link.price?.currency ?? "USD",
    condition: link.condition ?? "",
    observedAt: link.observedAt?.slice(0, 10) ?? "",
    ...(link.observedAt ? { storedObservedAt: link.observedAt } : {}),
  };
}

/**
 * The observedAt to save: the stored timestamp when the date input still shows
 * its day, otherwise whatever the input now says. Sending the original back
 * keeps the store's rule working: a changed ask that arrives with its old
 * observedAt is re-dated to now (keptObservedAt in listing-history.mjs
 * recognizes both the full timestamp and its date).
 */
export function observedAtForSave(row: Pick<LinkRow, "observedAt" | "storedObservedAt">): string | undefined {
  if (!row.observedAt) return undefined;
  if (row.storedObservedAt && row.storedObservedAt.slice(0, 10) === row.observedAt) return row.storedObservedAt;
  return row.observedAt;
}
