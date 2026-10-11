import { promises as fs } from "fs";
import { normalizeTags } from "./categories";
import path from "path";
import { Money, RetailerLink, SaleListing, SoldComp, Watch, WatchInput } from "./types";
import { recordWatchAlerts } from "./alert-store";
import { carryAskHistories } from "./listing-history.mjs";
import { appendSnapshot, sameMoney } from "./price-history";
import { DESIGN_ELO_BASE, DesignComparisonOutcome, updateDesignElo } from "./scoring";
import { validateWatchCollection } from "./validation";
import { listingIdentity, listingRevision } from "./listing-entry";
import { targetRevision } from "./target-entry";
import { soldCompRevision } from "./sold-comp-entry";
import { withCrystalArInference } from "./quality-flags";

// The collection lives in a single JSON file at the repo root so it can be
// version-controlled and backed up alongside the app. When you later want to
// use this on multiple devices, swap this module for a database-backed one and
// keep the same function signatures.
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_PATH = path.join(DATA_DIR, "watches.json");
let writeQueue: Promise<void> = Promise.resolve();

export async function getWatches(): Promise<Watch[]> {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf-8");
    const data = JSON.parse(raw);
    return validateWatchCollection(data);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

export async function getWatch(id: string): Promise<Watch | undefined> {
  const watches = await getWatches();
  return watches.find((w) => w.id === id);
}

export async function getWatchesByIds(ids: string[]): Promise<Watch[]> {
  const watches = await getWatches();
  const byId = new Map(watches.map((w) => [w.id, w]));
  // Preserve the order the ids were requested in.
  return ids.map((id) => byId.get(id)).filter((w): w is Watch => Boolean(w));
}

async function saveAll(watches: Watch[]): Promise<void> {
  validateWatchCollection(watches);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpPath = `${DATA_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(watches, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, DATA_PATH);
}

export async function addWatch(input: WatchInput): Promise<Watch> {
  return withWriteLock(async () => {
    const watches = await getWatches();
    const now = new Date().toISOString();
    const watch: Watch = withCrystalArInference({
      ...input,
      tags: normalizeTags(input.tags),
      id: generateId(),
      dateAdded: now,
    });
    // Seed the series so a watch added with a price starts with one data point
    // rather than needing a later change to acquire any history at all.
    if (watch.price && !watch.priceHistory?.length) {
      watch.priceHistory = appendSnapshot([], watch.price, watch.priceUpdatedAt ?? now, "manual");
    }
    watches.push(watch);
    await saveAll(watches);
    return watch;
  });
}

export async function updateWatch(
  id: string,
  patch: Partial<WatchInput>
): Promise<Watch | undefined> {
  return changeWatch(id, () => patch);
}

export class ListingConflictError extends Error {}

/** Read the current links inside the same lock as the write. A client sends
 * one listing, never a stale array that could erase an intervening addition. */
export async function saveWatchListing(id: string, listing: RetailerLink, expectedRevision?: string) {
  return changeWatch(id, (existing) => {
    const index = existing.links.findIndex(link => listingIdentity(link.url) === listingIdentity(listing.url));
    if (expectedRevision === undefined) {
      if (index !== -1) throw new ListingConflictError("This listing is already recorded. Use Edit listing to update it.");
      return { links: [...existing.links, listing] };
    }
    if (index === -1 || listingRevision(existing.links[index]) !== expectedRevision) {
      throw new ListingConflictError("This listing changed elsewhere. Your draft is still here. Cancel and reopen it to review the latest version.");
    }
    const current = existing.links[index];
    // Keep the exact stored URL so the shared history matcher can carry its
    // trail. Do not send askHistory: that would suppress recording a move.
    const replacement = { ...listing, url: current.url, retailer: current.retailer || listing.retailer };
    return { links: existing.links.map((link, i) => i === index ? replacement : link) };
  });
}

export class SoldCompConflictError extends Error {}

/** Append one sale inside the write lock. The form used to send the whole
 * soldComps array, which a stale page could use to erase a newer sale. */
export async function addSoldComp(id: string, comp: SoldComp) {
  return changeWatch(id, (existing) => ({ soldComps: [...(existing.soldComps ?? []), comp] }));
}

/** Remove the stored sale matching the one the page showed, by content rather
 * than position, so a reordered or changed list can't lose a different sale. */
export async function removeSoldComp(id: string, revision: string) {
  return changeWatch(id, (existing) => {
    const comps = existing.soldComps ?? [];
    const index = comps.findIndex((comp) => soldCompRevision(comp) === revision);
    if (index === -1) throw new SoldCompConflictError("This sale changed or was already removed. The list has been refreshed.");
    const remaining = comps.filter((_, i) => i !== index);
    // No empty `soldComps: []` left behind in watches.json.
    return { soldComps: remaining.length ? remaining : undefined };
  });
}

export class TargetConflictError extends Error {}

/** Set or clear only the target. Changing a target is the collector's own act,
 * so detectAlerts never fires target_met for it; a later price move does. */
export async function saveWatchTarget(id: string, target: Money | undefined, expectedRevision: string) {
  return changeWatch(id, (existing) => {
    if (targetRevision(existing.targetPrice) !== expectedRevision) {
      throw new TargetConflictError("This target changed elsewhere. Cancel and reopen it to review the latest value.");
    }
    return { targetPrice: target };
  });
}

export class SaleStateError extends Error {}

/** Publish, update or remove the public listing. Only sale-store.ts calls
 * this, after it has written the photos the listing points at. */
export async function setPublicListing(id: string, listing: SaleListing | undefined) {
  return changeWatch(id, (existing) => {
    if (listing && existing.status !== "owned") throw new SaleStateError("Only an owned watch can be listed for sale.");
    return { listing };
  });
}

/**
 * Close a sale: the watch becomes sold, its listing closes, and the sale is
 * appended as a SoldComp — your own sale is real evidence of what the model
 * sells for, unlike your ask, which never enters valuation. Changing status
 * and adding a comp fire no alert (detectAlerts compares prices and links).
 */
export async function recordOwnSale(id: string, sale: NonNullable<Watch["sale"]>, comp: SoldComp) {
  return changeWatch(id, (existing) => {
    if (existing.status !== "owned") throw new SaleStateError("Only an owned watch can be marked sold.");
    return { status: "sold", sale, listing: undefined, soldComps: [...(existing.soldComps ?? []), comp] };
  });
}

async function changeWatch(id: string, makePatch: (watch: Watch) => Partial<WatchInput>): Promise<Watch | undefined> {
  return withWriteLock(async () => {
    const watches = await getWatches();
    const idx = watches.findIndex((w) => w.id === id);
    if (idx === -1) return undefined;
    // id and dateAdded are immutable.
    const existing = watches[idx];
    const patch = makePatch(existing);
    const next: Watch = withCrystalArInference({ ...existing, ...patch, id: existing.id, dateAdded: existing.dateAdded });
    // Tags are stored lowercase, so "GMT" and "gmt" can't become two chips
    // and two filter entries again. Display casing comes from tagLabel().
    if (patch.tags) next.tags = normalizeTags(patch.tags);

    // Listing trails get the same treatment for the same reason: the form
    // rebuilds links without askHistory, so the store is the one place that
    // can both keep existing trails and record a changed ask for every caller.
    if (patch.links) {
      next.links = carryAskHistories(existing.links, patch.links, new Date().toISOString(), "manual");
    }

    // Record a move whenever an edit changes the tracked price. Doing it here
    // rather than in the form means hand-written API calls and future callers
    // build history too, and a caller that supplies its own priceHistory (an
    // importer, say) is left alone.
    if (next.price && !sameMoney(existing.price, next.price) && patch.priceHistory === undefined) {
      const observedAt = patch.priceUpdatedAt ?? new Date().toISOString();

      // A watch that predates price tracking has no series, so its outgoing
      // price would be lost on the very first edit. Seed it first, dated to
      // when that price was last known, so the first recorded move shows what
      // it moved *from* rather than starting the story at the new number.
      let history = existing.priceHistory;
      if (!history?.length && existing.price) {
        history = appendSnapshot([], existing.price, existing.priceUpdatedAt ?? existing.dateAdded, "manual");
      }

      next.priceHistory = appendSnapshot(history, next.price, observedAt, "manual");
      next.priceUpdatedAt = observedAt;
    }

    watches[idx] = next;
    await saveAll(watches);

    // After the save, and unable to undo it: an alert is a side effect of the
    // edit, so a problem writing alerts.json is logged rather than thrown.
    try {
      await recordWatchAlerts(existing, next);
    } catch (error) {
      console.error("Could not record alerts:", error);
    }
    return watches[idx];
  });
}

export async function deleteWatch(id: string): Promise<boolean> {
  return withWriteLock(async () => {
    const watches = await getWatches();
    const next = watches.filter((w) => w.id !== id);
    if (next.length === watches.length) return false;
    await saveAll(next);
    return true;
  });
}

export async function recordDesignComparison(
  leftId: string,
  rightId: string,
  outcome: DesignComparisonOutcome
): Promise<{ left: Watch; right: Watch } | undefined> {
  return withWriteLock(async () => {
    if (leftId === rightId) return undefined;
    const watches = await getWatches();
    const leftIndex = watches.findIndex((watch) => watch.id === leftId);
    const rightIndex = watches.findIndex((watch) => watch.id === rightId);
    if (leftIndex === -1 || rightIndex === -1) return undefined;

    const left = watches[leftIndex];
    const right = watches[rightIndex];
    // Comparisons refine ties; crossing appeal bands would undermine the
    // meaning of the anchored 1-5 rating.
    if (
      left.designUniqueness === undefined ||
      right.designUniqueness === undefined ||
      left.designUniqueness !== right.designUniqueness
    ) {
      return undefined;
    }

    const updated = updateDesignElo(
      left.designPreferenceElo ?? DESIGN_ELO_BASE,
      right.designPreferenceElo ?? DESIGN_ELO_BASE,
      outcome
    );
    watches[leftIndex] = {
      ...left,
      designPreferenceElo: updated.left,
      designComparisonCount: (left.designComparisonCount ?? 0) + 1,
    };
    watches[rightIndex] = {
      ...right,
      designPreferenceElo: updated.right,
      designComparisonCount: (right.designComparisonCount ?? 0) + 1,
    };
    await saveAll(watches);
    return { left: watches[leftIndex], right: watches[rightIndex] };
  });
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function withWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(work, work);
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
