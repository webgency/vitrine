"use client";

import Link from "next/link";
import { toDisplayScore, type StandingSummary } from "@/lib/scoring";
import { DIMENSION_LABELS } from "@/lib/rubrics";
import { movementNote } from "@/lib/movement-notes";
import { Watch, WishlistTier } from "@/lib/types";
import { formatMoney, formatOrdinal } from "@/lib/format";
import { targetStatus } from "@/lib/price-history";
import { bestOffer, bestOfferTargetStatus } from "@/lib/valuation";
import { offerNews } from "@/lib/offer-news";
import EvidenceCoverage from "./EvidenceCoverage";
import FreshnessBadge from "./FreshnessBadge";
import StatusBadge from "./StatusBadge";
import WishlistTierBadge from "./WishlistTierBadge";
import PriorityMenu from "./PriorityMenu";
import FinalistToggle from "./FinalistToggle";
import { canBeFinalist } from "@/lib/finalists";
import { IS_STATIC } from "@/lib/config";
import { tagLabel } from "@/lib/categories";

function initials(watch: Watch): string {
  const a = watch.brand?.trim()?.[0] ?? "?";
  const b = watch.model?.trim()?.[0] ?? "";
  return (a + b).toUpperCase();
}

export default function WatchCard({
  watch,
  selected,
  selectionDisabled,
  scoreSummary,
  onToggleSelect,
  onChangeWishlistTier,
}: {
  watch: Watch;
  selected: boolean;
  selectionDisabled?: boolean;
  scoreSummary?: StandingSummary;
  onToggleSelect: (id: string) => void;
  onChangeWishlistTier?: (id: string, next: WishlistTier | "") => Promise<boolean>;
}) {
  const { specs } = watch;
  const target = targetStatus(watch);
  const offer = bestOffer(watch);
  const offerTarget = bestOfferTargetStatus(watch, offer);
  const news = offerNews(watch, offer, offerTarget, target?.met ?? false);
  const href = `/watch/${watch.id}`;
  return (
    <div className={`card group relative transition-shadow hover:shadow-md ${selected ? "ring-2 ring-cocoa-900 bg-azalea-50" : ""}`}>
      <div className="relative flex h-64 overflow-hidden rounded-t-xl items-center justify-center bg-gradient-to-br from-cocoa-100 to-cocoa-200">
        {/* Image and title are the navigation. A stretched overlay link would
            cover the Compare checkbox and the priority menu, which then need
            z-index and click-stopping to claw their way back out. */}
        <Link href={href} tabIndex={-1} aria-hidden className="absolute inset-0">
          {watch.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={watch.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-3xl font-bold text-cocoa-400">
              {initials(watch)}
            </span>
          )}
        </Link>
        {/* Opposite Compare: both act on the card, neither navigates. */}
        {canBeFinalist(watch) && (IS_STATIC ? (
          watch.finalist && (
            <span className="absolute left-2 top-2 rounded-full bg-azalea px-2 py-1 text-xs font-medium text-cocoa-950 shadow-sm">★ Finalist</span>
          )
        ) : (
          <div className="absolute left-2 top-2">
            <FinalistToggle watchId={watch.id} watchName={`${watch.brand} ${watch.model}`} finalist={Boolean(watch.finalist)} />
          </div>
        ))}
        <label className="absolute right-2 top-2 flex cursor-pointer items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-medium shadow-sm">
          <input
            type="checkbox"
            checked={selected}
            disabled={selectionDisabled}
            aria-label={`Compare ${watch.brand} ${watch.model}`}
            aria-describedby={selectionDisabled ? "comparison-limit" : undefined}
            onChange={() => onToggleSelect(watch.id)}
            className="h-3.5 w-3.5 accent-cocoa-900"
          />
          Compare
        </label>
      </div>
      <div className="space-y-3 p-4">
        {/* Keep the model full-width: priority is secondary and must not steal
            the space that distinguishes similarly named watch variants. Reserve
            two model lines and a reference line so prices align within a row. */}
        <div className="min-h-[6rem] min-w-0">
          <div className="flex min-h-8 items-center justify-between gap-2">
            <p className="min-w-0 text-xs font-semibold uppercase tracking-wide text-cocoa-500">{watch.brand}</p>
            <div className="flex shrink-0 items-center gap-1">
              {onChangeWishlistTier ? (
                <PriorityMenu tier={watch.wishlistTier} watchName={`${watch.brand} ${watch.model}`} onChange={next => onChangeWishlistTier(watch.id, next)} allowNone={watch.status !== "wishlist"} />
              ) : <WishlistTierBadge tier={watch.wishlistTier} />}
              <StatusBadge status={watch.status} />
            </div>
          </div>
          <Link href={href} title={watch.model} className="line-clamp-2 min-h-[2.75rem] font-semibold leading-snug hover:underline">
            {watch.model}
          </Link>
          {watch.referenceNumber && (
            <p className="truncate text-xs text-cocoa-400">Ref. {watch.referenceNumber}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight">{formatMoney(watch.price)}</span>
            {target?.met && (
              <span
                className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                title={`At or below your ${formatMoney(target.target)} target`}
              >
                at target
              </span>
            )}
          </span>
          <span className="flex-shrink-0 text-xs text-cocoa-500">
            {[specs.caseDiameterMm ? `${specs.caseDiameterMm}mm` : null, specs.movement].filter(Boolean).join(" · ")}
          </span>
        </div>

        {/* Shown only when it differs from what the card already says: another
            price, an offer gone stale, a non-new condition, or an offer at
            target. Restating the headline price on every card buried those. */}
        {offer.status === "available" && news.length > 0 && (
          <div className="rounded-lg border border-cocoa-100 bg-cocoa-50 px-2.5 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <p className="min-w-0 flex-1 truncate font-medium text-cocoa-700">
                Best offer {formatMoney(offer.offer.price)} · {offer.offer.source}
              </p>
              {news.includes("not-fresh") && (
                <FreshnessBadge tier={offer.offer.freshness} ageDays={offer.offer.ageDays} compact />
              )}
            </div>
            {(news.includes("condition") || news.includes("at-target")) && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-cocoa-500">
                {news.includes("condition") && (
                  <span className="capitalize">{offer.offer.condition ?? "condition unknown"}</span>
                )}
                {offer.conditionMatch === "fallback" && <span>· condition fallback</span>}
                {offer.conditionMatch === "unknown" && <span>· unverified condition</span>}
                {news.includes("at-target") && (
                  <span
                    className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800"
                    title="Listed price only; shipping and duty are not recorded for this retailer offer"
                  >
                    offer at target before extras
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {offer.status === "insufficient" && (
          <p className="py-1 text-xs text-cocoa-500">
            No dated offers{offer.undatedOfferCount ? ` · ${offer.undatedOfferCount} undated price${offer.undatedOfferCount === 1 ? "" : "s"} excluded` : ""}
          </p>
        )}

        {scoreSummary && <StandingBlock summary={scoreSummary} watch={watch} />}

        {watch.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {watch.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded bg-cocoa-100 px-1.5 py-0.5 text-xs text-cocoa-600">
                {tagLabel(tag)}
              </span>
            ))}
          </div>
        )}


      </div>
    </div>
  );
}

type HeroScore = { key: "value" | "design"; label: string; value: number };

/**
 * One number gets to be the card's score. Rubric value answers the question the
 * collection is for — is this watch worth its price — so it leads whenever it is
 * rated; design appeal is the fallback because it is the other score the user
 * enters by hand. Everything else is context and reads as context.
 */
function heroScore(summary: StandingSummary): HeroScore | null {
  const { valueScore } = summary.standing;
  if (valueScore !== undefined) {
    return { key: "value", label: "Rubric value", value: Math.round(toDisplayScore(valueScore)) };
  }
  if (summary.designScore !== null) {
    return { key: "design", label: "Design", value: Math.round(summary.designScore) };
  }
  return null;
}

function StandingBlock({ summary, watch }: { summary: StandingSummary; watch: Watch }) {
  const { standing } = summary;
  const hero = heroScore(summary);
  const note = movementNote(watch);
  const dimensionList = (dimensions: typeof standing.beats) =>
    dimensions.map((dimension) => DIMENSION_LABELS[dimension]).join(", ");

  const context: { key: string; text: string; title: string; warn?: boolean }[] = [];
  if (standing.qualityScore !== undefined) {
    context.push({
      key: "quality",
      text: `Quality ${Math.round(toDisplayScore(standing.qualityScore))}`,
      title: "Composite of the rated dimensions",
    });
  }
  if (summary.designScore !== null && hero?.key !== "design") {
    context.push({
      key: "design",
      text: `Design ${Math.round(summary.designScore)}`,
      title: "Your design-appeal score",
    });
  }
  if (watch.personalFit) {
    context.push({ key: "fit", text: `Fit ${watch.personalFit}/5`, title: "Your personal-fit rating" });
  }

  return (
    <div className="space-y-2 text-xs">
      {/* The hero pill is the only filled element in the card body, so the eye
          lands on one score. The rest is a single muted line — present, legible,
          and clearly subordinate — rather than four competing pills. */}
      <div>
        {hero ? (
          <span
            title={
              hero.key === "value"
                ? `Rubric value against the continuous expectation at this price. Peer label: ${standing.peerLabel}. 50 is expected.`
                : "Your design-appeal score"
            }
            className="inline-block rounded-full bg-cocoa-900 px-2.5 py-1 font-semibold text-white"
          >
            {hero.label} {hero.value}
          </span>
        ) : (
          <span
            title="Neither a rubric value nor a design rating has enough recorded input to score"
            className="inline-block rounded-full bg-cocoa-100 px-2.5 py-1 font-medium text-cocoa-400"
          >
            Scores unrated
          </span>
        )}
        {context.length > 0 && (
          <p className="mt-1.5 text-cocoa-400">
            {context.map((chip, index) => (
              <span key={chip.key} title={chip.title} className={chip.warn ? "text-amber-700" : undefined}>
                {index > 0 && <span className="text-cocoa-300"> · </span>}
                {chip.text}
              </span>
            ))}
          </p>
        )}
      </div>

      <EvidenceCoverage watch={watch} standing={standing} />

      {/* Frictions are text, never a score, and they are rare — a card that has
          one is saying something the price and score cannot. Keep them visible.
          A movement note shares the row but not the amber: it describes the
          watch rather than warning about buying it. */}
      {(standing.frictions.length > 0 || note) && (
        <div className="flex flex-wrap gap-1">
          {note && (
            <span title={note.detail} className="rounded bg-cocoa-100 px-1.5 py-0.5 font-medium text-cocoa-600">
              {note.label}
            </span>
          )}
          {standing.frictions.map((friction) => (
            <span key={friction} className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">
              {friction}
            </span>
          ))}
        </div>
      )}

      <details className="group/detail">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-cocoa-400 hover:text-cocoa-700 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="transition-transform group-open/detail:rotate-90">
            &#9656;
          </span>
          Score details
        </summary>
        <div className="mt-1.5 space-y-1 pl-3">
          <p className="text-cocoa-500">
            {standing.peerLabel}
            {standing.qualityPercentile !== undefined &&
              ` · ${formatOrdinal(standing.qualityPercentile * 100)} percentile of ${standing.peerCount} peers`}
          </p>
          {standing.beats.length > 0 && (
            <p className="text-emerald-700">Above expectations: {dimensionList(standing.beats)}</p>
          )}
          {standing.trails.length > 0 && (
            <p className="text-amber-700">Below expectations: {dimensionList(standing.trails)}</p>
          )}
          {standing.unrated.length > 0 && (
            <p
              className="text-cocoa-400"
              title="No source data recorded for these dimensions, so they are excluded from the scores"
            >
              Unrated: {dimensionList(standing.unrated)}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
