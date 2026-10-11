import CollectionLink from "@/components/CollectionLink";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { getWatch, getWatches } from "@/lib/store";
import { getAlertState } from "@/lib/alert-store";
import { computeStanding } from "@/lib/scoring";
import { formatMoney, formatDate } from "@/lib/format";
import { IS_STATIC } from "@/lib/config";
import StatusBadge from "@/components/StatusBadge";
import WishlistTierBadge from "@/components/WishlistTierBadge";
import WatchActions from "@/components/WatchActions";
import StandingPanel from "@/components/StandingPanel";
import PriceHistoryPanel from "@/components/PriceHistoryPanel";
import MarketChapter from "@/components/MarketChapter";
import KeySpecStrip from "@/components/KeySpecStrip";
import DecisionSummary from "@/components/DecisionSummary";
import TradeUpPanel from "@/components/TradeUpPanel";
import { tradeUpModel } from "@/lib/trade-up";
import TargetEditor from "@/components/TargetEditor";
import PurchasePanel from "@/components/PurchasePanel";
import SellPanel from "@/components/SellPanel";
import ForSaleCard from "@/components/ForSaleCard";
import { saleListingView } from "@/lib/sale-store";
import { getSeller } from "@/lib/seller";
import { getPrivateRecord } from "@/lib/private-store";
import { targetStatus } from "@/lib/price-history";
import OwnershipSection from "@/components/OwnershipSection";
import { ownershipItems } from "@/lib/ownership";
import { tagLabel } from "@/lib/categories";

// An empty generateStaticParams result opts into on-demand static generation.
// Explicit dynamic rendering prevents noStore() from failing at request time;
// prepare-pages switches this to force-static for the read-only export.
export const dynamic = "force-dynamic";

// Pre-render a detail page for every watch in the static export. In dynamic
// mode return nothing so pages render on demand and reflect edits immediately.
export async function generateStaticParams() {
  if (!IS_STATIC) return [];
  const watches = await getWatches();
  return watches.map((w) => ({ id: w.id }));
}

export default async function WatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!IS_STATIC) noStore();
  const { id } = await params;
  // The whole collection is the peer pool, matching the collection and value
  // pages, so a watch's band and percentile read the same everywhere.
  const [watch, watches, privateRecord, seller, alertState] = await Promise.all([
    getWatch(id),
    getWatches(),
    // Seller-private data, read beside the watch and never merged into it.
    // The store returns nothing in the static build.
    IS_STATIC ? undefined : getPrivateRecord(id),
    getSeller(),
    // A broken alerts file is logged and shown as unknown status rather than
    // failing the whole detail page, as the nav badge does.
    getAlertState().catch((error) => {
      console.error(error);
      return undefined;
    }),
  ]);
  if (!watch) notFound();
  const standing = computeStanding(watch, watches);
  const tradeUp = tradeUpModel(watch, watches);
  const target = targetStatus(watch);
  const owned = watch.status === "owned";
  const listingView = owned && !IS_STATIC ? saleListingView(watch, privateRecord) : undefined;
  // Purchase and sale panels are local-only, so on the static export they are
  // left out of the list rather than shown collapsed with nothing behind them.
  const ownership = owned
    ? ownershipItems({
        purchaseRecorded: IS_STATIC ? undefined : Boolean(privateRecord?.purchase?.price),
        exitSources: tradeUp?.exit.observations.length,
        listingState: listingView?.state,
      })
    : [];

  // Page order is the reading order: what it is, what it is made of, then what
  // to do about it. Each chapter owns a fixed position so later chapters
  // (market, trade-up) fill their slot without reflowing the rest.
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <CollectionLink className="btn-secondary">
          ← Collection
        </CollectionLink>
        {!IS_STATIC && <WatchActions id={watch.id} name={`${watch.brand} ${watch.model}`} />}
      </div>

      {/* An open image stage lets the object lead; nearby measurements answer
          fit questions before the deeper decision and market evidence. */}
      <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
        <div className="flex h-80 items-center justify-center sm:h-[30rem] md:sticky md:top-6 md:h-[36rem]">
          {watch.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={watch.imageUrl}
              alt={`${watch.brand} ${watch.model}`}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-6xl font-bold text-cocoa-300">
              {(watch.brand[0] ?? "?").toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 md:py-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-cocoa-500">{watch.brand}</p>
            <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight text-cocoa-950 sm:text-4xl">
              {watch.model}
            </h1>
            {watch.referenceNumber && <p className="mt-1 text-sm text-cocoa-500">Ref. {watch.referenceNumber}</p>}
            {(watch.wishlistTier || watch.status !== "wishlist") && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <WishlistTierBadge tier={watch.wishlistTier} />
                <StatusBadge status={watch.status} />
              </div>
            )}
          </div>

          <div>
            <p className="text-4xl font-bold tracking-tight tabular-nums text-cocoa-950">{formatMoney(watch.price)}</p>
            {watch.priceUpdatedAt && (
              <p className="mt-1 text-xs text-cocoa-400">Price updated {formatDate(watch.priceUpdatedAt)}</p>
            )}
            {/* A target is a buying decision, so an owned watch without one gets
                no prompt; one that already has a target can still edit it. */}
            {(watch.targetPrice || (watch.status === "wishlist" && !IS_STATIC)) && (
              <div className="mt-2">
                <TargetEditor
                  watchId={watch.id}
                  watchLabel={`${watch.brand} ${watch.model}`}
                  target={watch.targetPrice}
                  label={watch.targetPrice ? "Edit target" : "Set target"}
                  summary={watch.targetPrice && (
                    <>
                      Target {formatMoney(watch.targetPrice)}
                      {target && (target.met ? " · met, all-in" : ` · ${formatMoney({ amount: Math.round(target.gapUsd), currency: "USD" })} above, all-in`)}
                    </>
                  )}
                />
              </div>
            )}
          </div>

          <KeySpecStrip watch={{ specs: watch.specs, qualityFlags: watch.qualityFlags }} />

          <DecisionSummary watch={watch} standing={standing} />

          <div className="space-y-2">
            {watch.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {watch.tags.map((t) => (
                  <span key={t} className="rounded-full bg-cocoa-100 px-2.5 py-1 text-xs font-medium text-cocoa-600">
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-cocoa-400">Added {formatDate(watch.dateAdded)}</p>
          </div>

          {/* Notes are your own context, so they sit with the headline rather
              than below every evidence panel. Long ones clamp until opened. */}
          {watch.notes && (
            <details className="group rounded-lg border border-cocoa-100 bg-cocoa-50 px-3 py-2">
              <summary className="cursor-pointer list-none text-sm text-cocoa-700 [&::-webkit-details-marker]:hidden">
                <span className="block text-xs font-semibold uppercase tracking-wide text-cocoa-500">Notes</span>
                <span className="mt-1 line-clamp-3 whitespace-pre-wrap group-open:line-clamp-none">{watch.notes}</span>
              </summary>
            </details>
          )}
        </div>
      </section>

      <div id="standing" className="scroll-mt-6 space-y-6">
        <StandingPanel watch={watch} standing={standing} />
        <PriceHistoryPanel watch={watch} />
      </div>

      {/* Market chapter. Asks, solds and the tracked price live here together;
          brief 05's drop trail lands inside this slot too. */}
      <div id="market" className="scroll-mt-6">
        <MarketChapter watch={watch} alertState={alertState} />
      </div>

      {watch.status === "owned" && watch.listing && (
        <div id="for-sale" className="scroll-mt-6">
          <ForSaleCard title={`${watch.brand} ${watch.model}`} listing={watch.listing} seller={seller} />
        </div>
      )}

      {owned && (
        <OwnershipSection
          items={ownership}
          panels={{
            purchase: !IS_STATIC && (
              <PurchasePanel
                watchId={watch.id}
                watchLabel={`${watch.brand} ${watch.model}`}
                purchase={privateRecord?.purchase}
                exitMedianUsd={tradeUp?.exit.medianUsd}
              />
            ),
            "trade-up": tradeUp && <TradeUpPanel model={tradeUp} />,
            sell: listingView && (
              <SellPanel
                watch={watch}
                view={listingView}
                purchase={privateRecord?.purchase?.price}
                exit={tradeUp && { medianUsd: tradeUp.exit.medianUsd, lowUsd: tradeUp.exit.lowUsd, highUsd: tradeUp.exit.highUsd, sources: tradeUp.exit.observations.length }}
              />
            ),
          }}
        />
      )}

      {/* A sold watch keeps its purchase record, outside the ownership tasks. */}
      {!IS_STATIC && watch.status === "sold" && (
        <div id="purchase" className="scroll-mt-6">
          <PurchasePanel
            watchId={watch.id}
            watchLabel={`${watch.brand} ${watch.model}`}
            purchase={privateRecord?.purchase}
            exitMedianUsd={tradeUp?.exit.medianUsd}
          />
        </div>
      )}
    </div>
  );
}
