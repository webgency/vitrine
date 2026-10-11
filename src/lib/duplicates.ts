import type { Watch } from "./types";

/** What the add form needs to know about each watch already tracked. */
export interface TrackedWatchKey {
  id: string;
  label: string;
  brand: string;
  referenceNumber?: string;
  urls: string[];
}

export interface DuplicateMatch {
  id: string;
  label: string;
  reason: "same-page" | "same-reference";
}

export function trackedWatchKeys(watches: Watch[]): TrackedWatchKey[] {
  return watches.map((watch) => ({
    id: watch.id,
    label: `${watch.brand} ${watch.model}`,
    brand: watch.brand,
    ...(watch.referenceNumber ? { referenceNumber: watch.referenceNumber } : {}),
    urls: watch.links.map((link) => link.url),
  }));
}

/**
 * Host and path only. Query strings are mostly tracking and session noise; a
 * Shopify `?variant=` can mean another dial, which is why a match is a warning
 * the owner can override rather than a block.
 */
export function normalizeProductUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Watches the one being added may duplicate: the same product page, or the
 * same brand and reference. Nothing here stops a save — two colourways can
 * share a page, and a reference can be recorded loosely.
 */
export function findDuplicates(
  candidate: { brand: string; referenceNumber?: string; urls: string[] },
  tracked: TrackedWatchKey[]
): DuplicateMatch[] {
  const pages = new Set(candidate.urls.map(normalizeProductUrl).filter((url): url is string => Boolean(url)));
  const brand = key(candidate.brand);
  const reference = key(candidate.referenceNumber ?? "");
  const matches: DuplicateMatch[] = [];
  for (const watch of tracked) {
    if (watch.urls.some((url) => pages.has(normalizeProductUrl(url) ?? ""))) {
      matches.push({ id: watch.id, label: watch.label, reason: "same-page" });
    } else if (reference.length >= 3 && brand && key(watch.brand) === brand && key(watch.referenceNumber ?? "") === reference) {
      matches.push({ id: watch.id, label: watch.label, reason: "same-reference" });
    }
  }
  return matches;
}
