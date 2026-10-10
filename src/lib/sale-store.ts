import { createHash } from "crypto";
import { getPrivateRecord, updatePrivateRecord, type PrivateWatchRecord, type SaleClose } from "./private-store";
import { photoAsDataUrl, prunePhotos, publishPhotos } from "./listing-photos";
import { getWatch, recordOwnSale, SaleStateError, setPublicListing } from "./store";
import type { Condition, ListingContent, Money, SaleListing, Watch } from "./types";
import type { FeeLine } from "./proceeds";

/**
 * Selling, across the two files it touches: the public listing and sale in
 * watches.json, and the draft, minimum, fees and buyer in data/private.json.
 * See docs/briefs/11-selling-first-slice.md.
 *
 * A draft lives only in private.json. Publishing moves it into watches.json
 * (writing its photos under public/listings/<id>/); moving it back to draft
 * reverses that. So a draft can't reach git or Pages by construction, rather
 * than by a filter someone could forget.
 */

export class SaleConflictError extends Error {}

export type SaleListingState = "none" | "draft" | SaleListing["state"];

export interface SaleListingView {
  state: SaleListingState;
  /** The draft, or the published listing's content. */
  content?: ListingContent;
  minimumPrice?: Money;
  listingFees?: FeeLine[];
  /** Short hash of everything the editor can change; refuses stale drafts. */
  revision: string;
}

export function saleRevision(watch: Pick<Watch, "status" | "listing">, record?: PrivateWatchRecord): string {
  const payload = JSON.stringify([watch.status, watch.listing ?? null, record?.listingDraft ?? null, record?.minimumPrice ?? null, record?.listingFees ?? null]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function saleListingView(watch: Watch, record?: PrivateWatchRecord): SaleListingView {
  const content = watch.listing ?? record?.listingDraft;
  return {
    state: watch.listing ? watch.listing.state : record?.listingDraft ? "draft" : "none",
    ...(content ? { content: stripState(content) } : {}),
    ...(record?.minimumPrice ? { minimumPrice: record.minimumPrice } : {}),
    ...(record?.listingFees ? { listingFees: record.listingFees } : {}),
    revision: saleRevision(watch, record),
  };
}

function stripState(content: ListingContent | SaleListing): ListingContent {
  const rest: Partial<SaleListing> = { ...content };
  delete rest.state;
  delete rest.listedAt;
  return rest as ListingContent;
}

async function loadOwned(id: string, revision: string) {
  const watch = await getWatch(id);
  if (!watch) return undefined;
  if (watch.status !== "owned") throw new SaleStateError("Only an owned watch can be listed or sold.");
  const record = await getPrivateRecord(id);
  if (saleRevision(watch, record) !== revision) {
    throw new SaleConflictError("This listing changed elsewhere. Your draft is still here. Cancel and reopen it to review the latest version.");
  }
  return { watch, record };
}

export interface ListingSave {
  state: "draft" | SaleListing["state"];
  /** Photos may mix data URLs (new) and this listing's published paths. */
  content: ListingContent;
  minimumPrice?: Money;
  listingFees?: FeeLine[];
}

export async function saveSaleListing(id: string, input: ListingSave, revision: string, now = new Date()) {
  const loaded = await loadOwned(id, revision);
  if (!loaded) return undefined;
  const { watch } = loaded;
  const privateFields = { minimumPrice: input.minimumPrice, listingFees: input.listingFees };

  if (input.state === "draft") {
    // Back to (or still) private: photos become data URLs again, and the
    // public listing and its files go.
    const photos = await Promise.all(input.content.photos.map((photo) => photo.startsWith("data:") ? photo : photoAsDataUrl(photo)));
    await updatePrivateRecord(id, (current) => ({ ...current, ...privateFields, listingDraft: { ...input.content, photos } }));
    if (watch.listing) await setPublicListing(id, undefined);
    await prunePhotos(id, []);
  } else {
    const photos = await publishPhotos(id, input.content.photos);
    const listing: SaleListing = { ...input.content, photos, state: input.state, listedAt: watch.listing?.listedAt ?? now.toISOString() };
    try {
      await setPublicListing(id, listing);
    } catch (error) {
      // The listing was refused (no photos, bad shape): don't leave the
      // files it would have pointed at.
      await prunePhotos(id, watch.listing?.photos ?? []);
      throw error;
    }
    await prunePhotos(id, photos);
    await updatePrivateRecord(id, (current) => ({ ...current, ...privateFields, listingDraft: undefined }));
  }
  const after = (await getWatch(id))!;
  return saleListingView(after, await getPrivateRecord(id));
}

/** Withdraw the listing entirely: no draft, no public listing, no photos. */
export async function withdrawSaleListing(id: string, revision: string) {
  const loaded = await loadOwned(id, revision);
  if (!loaded) return undefined;
  if (loaded.watch.listing) await setPublicListing(id, undefined);
  await prunePhotos(id, []);
  await updatePrivateRecord(id, (current) => ({ ...current, listingDraft: undefined, minimumPrice: undefined, listingFees: undefined }));
  return saleListingView((await getWatch(id))!, await getPrivateRecord(id));
}

export interface SoldInput {
  price: Money;
  /** YYYY-MM-DD. */
  date: string;
  channel: string;
  /** How the sale counts as market evidence. An unworn watch is a judgment
   * call, so the form asks rather than guessing. */
  countAs: Condition;
  close: SaleClose;
}

export async function markWatchSold(id: string, input: SoldInput, revision: string) {
  const loaded = await loadOwned(id, revision);
  if (!loaded) return undefined;
  const sold = await recordOwnSale(
    id,
    { price: input.price, date: input.date, channel: input.channel },
    { price: input.price, condition: input.countAs, soldAt: input.date, source: `Own sale — ${input.channel}` },
  );
  await prunePhotos(id, []);
  // Keep what you paid (it's the basis for gain or loss); the listing's
  // private working values are done with.
  await updatePrivateRecord(id, (current) => ({
    ...current,
    saleClose: input.close,
    listingDraft: undefined,
    minimumPrice: undefined,
    listingFees: undefined,
  }));
  return sold;
}
