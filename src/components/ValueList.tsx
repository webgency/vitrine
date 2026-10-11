"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { formatMoney, titleCase } from "@/lib/format";
import { caliberTier, deriveCategory, landedPriceUsd, StandingSummary, toDisplayScore } from "@/lib/scoring";
import { SCORING_CATEGORIES, Watch, WatchStatus, WISHLIST_TIERS, WISHLIST_TIER_LABELS, WishlistTier } from "@/lib/types";
import { bestOffer, bestOfferTargetStatus, dealScore } from "@/lib/valuation";
import { anyDealEvidence, compareValueRows, effectiveDealControls, matchesValueFilters, ValueFilters, ValueRow, ValueSortKey } from "@/lib/value-list";
import { matchesWatchSearch } from "@/lib/watch-search";
import { useValueFilters } from "@/hooks/useResearchSession";
import EvidenceCoverage from "./EvidenceCoverage";
import FreshnessBadge from "./FreshnessBadge";

const SORTS: Array<{ value: ValueSortKey; label: string }> = [
  { value: "value", label: "Rubric value: high to low" },
  { value: "deal", label: "Deal: best discount" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "size", label: "Case size" },
  { value: "design", label: "Design rank" },
  { value: "recent", label: "Recently added" },
  { value: "name", label: "Brand / model" },
];

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function ValueList({
  watches,
  summaries,
  nowIso,
}: {
  watches: Watch[];
  summaries: Record<string, StandingSummary>;
  nowIso: string;
}) {
  const { filters: session, update } = useValueFilters();
  const { query, status, category, minPrice, maxPrice, minDesign, confidence, wishlistTier } = session;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();

  const rows = useMemo(() => {
    const now = new Date(nowIso);
    return watches
      .filter((watch) => watch.status !== "sold")
      .map((watch): ValueRow => {
        const offer = bestOffer(watch, undefined, now);
        return {
          watch,
          summary: summaries[watch.id],
          category: deriveCategory(watch),
          priceUsd: landedPriceUsd(watch),
          deal: dealScore(watch, undefined, now),
          offer,
          targetMet: bestOfferTargetStatus(watch, offer)?.met ?? false,
        };
      });
  }, [watches, summaries, nowIso]);

  // Deal controls exist only once some watch has a deal; until then every
  // row would read "Insufficient". A saved deal sort or filter falls back.
  const dealsExist = anyDealEvidence(rows);
  const { sort, hasDealEvidence } = effectiveDealControls(session.sort, session.hasDealEvidence, dealsExist);
  const sorts = dealsExist ? SORTS : SORTS.filter((option) => option.value !== "deal");
  const activeFilterCount = [status !== "wishlist", category !== "all", minPrice !== "" || maxPrice !== "", minDesign !== "", confidence !== "all", hasDealEvidence, wishlistTier !== "all"].filter(Boolean).length;

  const filters: ValueFilters = {
    status,
    category,
    minPrice: numberOrUndefined(minPrice),
    maxPrice: numberOrUndefined(maxPrice),
    minDesign: numberOrUndefined(minDesign),
    confidence,
    hasDealEvidence,
    wishlistTier,
  };
  const visible = rows.filter((row) => matchesValueFilters(row, filters) && matchesWatchSearch(row.watch, query)).sort((a, b) => compareValueRows(a, b, sort));

  function resetFilters() {
    update({ query: "", status: "wishlist", category: "all", minPrice: "", maxPrice: "", minDesign: "", confidence: "all", hasDealEvidence: false, wishlistTier: "all" });
  }

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
          <label className="label min-w-0">
            Search watches
            <span className="relative mt-1 block">
              <input type="search" className="input min-h-11 pr-16" placeholder="Brand, model, reference, caliber" value={query} onChange={event => update({ query: event.target.value }, true)} />
              {query && <button type="button" aria-label="Clear search" className="absolute inset-y-0 right-1 min-w-14 text-sm font-medium normal-case tracking-normal text-azalea-700" onClick={() => update({ query: "" })}>Clear</button>}
            </span>
          </label>
          <Filter label="Sort by">
            <select className="input" value={sort} onChange={(event) => update({ sort: event.target.value as ValueSortKey })}>
              {sorts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Filter>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 lg:hidden">
          <button type="button" aria-expanded={filtersOpen} aria-controls={filterPanelId} onClick={() => setFiltersOpen(!filtersOpen)} className="btn-secondary min-h-11">
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
          </button>
          {activeFilterCount > 0 && !filtersOpen && <button type="button" onClick={resetFilters} className="min-h-11 text-sm font-medium text-azalea-700 hover:underline">Reset filters</button>}
        </div>
        {/* Keep one set of URL-backed controls across breakpoints. Collapsing
            the mobile panel never clears a filter restored from a shared URL. */}
        <div id={filterPanelId} className={`${filtersOpen ? "block" : "hidden"} mt-4 border-t border-cocoa-100 pt-4 lg:block`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Filter label="Status">
              <select className="input" value={status} onChange={(event) => update({ status: event.target.value as WatchStatus | "all" })}>
                <option value="wishlist">Wishlist</option><option value="owned">Owned</option><option value="all">Wishlist + owned</option>
              </select>
            </Filter>
            <Filter label="Category">
              <select className="input" value={category} onChange={(event) => update({ category: event.target.value as ValueFilters["category"] })}>
                <option value="all">All categories</option>
                {SCORING_CATEGORIES.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}
              </select>
            </Filter>
            <Filter label="Priority">
              <select className="input" value={wishlistTier} onChange={(event) => update({ wishlistTier: event.target.value as WishlistTier | "all" })}>
                <option value="all">All priorities</option>
                {WISHLIST_TIERS.map((tier) => <option key={tier} value={tier}>{WISHLIST_TIER_LABELS[tier]}</option>)}
              </select>
            </Filter>
            <Filter label="Minimum USD price"><input className="input" inputMode="numeric" value={minPrice} onChange={(event) => update({ minPrice: event.target.value }, true)} placeholder="No minimum" /></Filter>
            <Filter label="Maximum USD price"><input className="input" inputMode="numeric" value={maxPrice} onChange={(event) => update({ maxPrice: event.target.value }, true)} placeholder="No maximum" /></Filter>
            <Filter label="Minimum design rank">
              <select className="input" value={minDesign} onChange={(event) => update({ minDesign: event.target.value })}>
                <option value="">Any / unrated</option><option value="3">3+</option><option value="4">4+</option><option value="5">5</option>
              </select>
            </Filter>
            <Filter label="Evidence coverage">
              <select className="input" value={confidence} onChange={(event) => update({ confidence: event.target.value as ValueFilters["confidence"] })}>
                <option value="all">All coverage levels</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low / limited</option>
              </select>
            </Filter>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {dealsExist ? (
              <label className="flex min-h-11 items-center gap-2 text-sm text-cocoa-600">
                <input type="checkbox" checked={hasDealEvidence} onChange={(event) => update({ hasDealEvidence: event.target.checked })} />
                Has sufficient deal evidence
              </label>
            ) : <span />}
            <button type="button" onClick={resetFilters} className="min-h-11 text-sm font-medium text-azalea-700 hover:underline">Reset filters</button>
          </div>
        </div>
      </section>

      <p role="status" className="text-sm text-cocoa-500">{visible.length} of {rows.length} watches · {status === "all" ? "Wishlist + owned" : titleCase(status)}<span className="sr-only"> · Sorted by {SORTS.find(option => option.value === sort)?.label}</span></p>

      {visible.length === 0 ? (
        <section className="card p-6 text-center">
          <p className="text-sm text-cocoa-500">No watches match your search and filters.</p>
          <button type="button" onClick={resetFilters} className="btn-secondary mt-4 min-h-11">Reset search and filters</button>
        </section>
      ) : (
        <>
        {/* Both layouts consume the same filtered, sorted rows. CSS chooses
            the presentation without client-only viewport state or a flash
            of the desktop table during static-page hydration. */}
        <ol aria-label="Watch results" className="grid gap-3 md:grid-cols-2 lg:hidden">
          {visible.map((row, index) => <li key={row.watch.id} className="min-w-0"><ValueCard row={row} rank={sort === "value" ? index + 1 : undefined} showDeal={dealsExist} /></li>)}
        </ol>
        <section aria-label="Watch results" className="card hidden overflow-hidden lg:block">
        <div className="overflow-x-auto" role="region" aria-label="Watch value comparison table" tabIndex={0}>
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="border-b border-cocoa-200 bg-cocoa-50 text-xs uppercase tracking-wide text-cocoa-500">
              <tr><th scope="col" className="px-4 py-3">Watch</th><th scope="col" className="px-3 py-3">Rubric value</th>{dealsExist && <th scope="col" className="px-3 py-3">Deal vs fair asks</th>}<th scope="col" className="px-3 py-3">Price</th><th scope="col" className="px-3 py-3">Best dated offer</th><th scope="col" className="px-3 py-3">Specs</th><th scope="col" className="px-3 py-3">Design</th><th scope="col" className="px-3 py-3">Target</th></tr>
            </thead>
            <tbody className="divide-y divide-cocoa-100">
              {visible.map((row, index) => <ValueTableRow key={row.watch.id} row={row} rank={sort === "value" ? index + 1 : undefined} showDeal={dealsExist} />)}
            </tbody>
          </table>
        </div>
        </section>
        </>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="label min-w-0 [&_.input]:mt-1 [&_.input]:min-h-11">{label}{children}</label>;
}

/**
 * A quiet note beside a value score built on thin evidence. Worded so it
 * claims no direction: unrecorded features could lift the score or lower it,
 * and neither is a verdict on the watch.
 */
function LowEvidenceHint({ standing }: { standing: ValueRow["summary"]["standing"] }) {
  if (standing.valueScore === undefined || standing.confidence !== "low") return null;
  return (
    <p className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
      Low evidence — value may shift as specs are added
    </p>
  );
}

function ValueCard({ row, rank, showDeal }: { row: ValueRow; rank?: number; showDeal: boolean }) {
  const { watch, summary, deal, offer } = row;
  const standing = summary.standing;
  const movementTier = caliberTier(watch.specs.caliber, watch.specs.movement);

  return (
    <article className="card h-full min-w-0 p-4">
      <p className="break-words text-xs font-semibold uppercase tracking-wide text-cocoa-500">{rank ? `#${rank} · ` : ""}{watch.brand}</p>
      <h2><Link href={`/watch/${watch.id}`} className="mt-1 block min-h-11 break-words text-base font-semibold leading-snug text-cocoa-900 hover:underline">{watch.model}</Link></h2>
      {/* Status only: a priority label here would read as a second verdict
          beside rubric value. Priority stays available as a filter. */}
      <p className="mt-1 text-xs text-cocoa-500">{titleCase(watch.status)}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-cocoa-100 pt-3">
        <div className="min-w-0">
          <dt className="text-xs text-cocoa-500">Rubric value</dt>
          <dd className="mt-1 text-2xl font-bold text-cocoa-900">{standing.valueScore === undefined ? <span className="text-sm font-semibold text-cocoa-500">Not scored</span> : Math.round(toDisplayScore(standing.valueScore))}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-cocoa-500">{watch.landedPrice ? "Landed price" : "Tracked price"}</dt>
          <dd className="mt-1 break-words text-lg font-semibold text-cocoa-900">{formatMoney(watch.landedPrice ?? watch.price)}</dd>
        </div>
      </dl>
      <LowEvidenceHint standing={standing} />
      <div className="[&_summary]:min-h-11 [&_summary]:py-3"><EvidenceCoverage watch={watch} standing={standing} /></div>
      {showDeal && <div className="border-t border-cocoa-100 pt-3 text-sm">
        <p className="mb-1 text-xs text-cocoa-500">Deal vs fair asks</p>
        {deal.status === "available" ? <><p className="font-semibold">{formatDiscount(deal.discountPct)}</p><p className="text-xs text-cocoa-500">Fair {formatMoney({ amount: deal.fairLowUsd, currency: "USD" })}–{formatMoney({ amount: deal.fairHighUsd, currency: "USD" })}</p></> : <p className="text-cocoa-500">Insufficient evidence · no discount calculated</p>}
      </div>}
      {watch.targetPrice && <p className="mt-3 text-xs text-cocoa-500">{row.targetMet ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">Target met</span> : <>Target {formatMoney(watch.targetPrice)}</>}</p>}
      <details className="mt-3 border-t border-cocoa-100 text-sm">
        <summary className="min-h-11 cursor-pointer rounded py-3 font-medium text-cocoa-700">Offer, specs &amp; design</summary>
        <dl className="space-y-4 pb-1">
          <div>
            <dt className="mb-1 text-xs font-semibold text-cocoa-500">Best dated offer</dt>
            <dd>{offer.status === "available" ? <><a href={offer.offer.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-words font-semibold text-azalea-700 hover:underline">{formatMoney(offer.offer.price)} ↗</a><p className="break-words text-xs text-cocoa-500">{offer.offer.source}</p><div className="mt-1"><FreshnessBadge tier={offer.offer.freshness} ageDays={offer.offer.ageDays} compact /></div></> : <span className="text-cocoa-500">No dated offer</span>}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs font-semibold text-cocoa-500">Specs</dt>
            <dd className="break-words text-cocoa-600">{row.category ? titleCase(row.category) : "Category unrated"} · {watch.specs.caseDiameterMm ? `${watch.specs.caseDiameterMm} mm` : "Size unrated"}<br />{watch.specs.caliber ?? watch.specs.movement ?? "Movement unrated"}{movementTier !== undefined ? ` · tier ${Math.round(movementTier * 100)}` : ""}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs font-semibold text-cocoa-500">Design · separate from rubric value</dt>
            <dd className="text-cocoa-600">{watch.designUniqueness ? `${watch.designUniqueness} / 5` : "Unrated"}{summary.designScore !== null && <span className="text-xs"> · Score {Math.round(summary.designScore)}</span>}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function ValueTableRow({ row, rank, showDeal }: { row: ValueRow; rank?: number; showDeal: boolean }) {
  const { watch, summary, deal, offer } = row;
  const standing = summary.standing;
  const movementTier = caliberTier(watch.specs.caliber, watch.specs.movement);
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-cocoa-400">{rank ? `#${rank} · ` : ""}{watch.brand}</p>
        <Link href={`/watch/${watch.id}`} className="font-semibold text-cocoa-900 hover:underline">{watch.model}</Link>
        <p className="mt-1 text-xs text-cocoa-500">{titleCase(watch.status)}</p>
      </td>
      <td className="px-3 py-4">
        {standing.valueScore === undefined ? <p className="font-semibold text-cocoa-500">Not scored</p> : <p className="text-lg font-bold text-cocoa-900">{Math.round(toDisplayScore(standing.valueScore))}</p>}
        <LowEvidenceHint standing={standing} />
        <EvidenceCoverage watch={watch} standing={standing} />
      </td>
      {showDeal && <td className="px-3 py-4">
        {deal.status === "available" ? <><p className="font-semibold">{formatDiscount(deal.discountPct)}</p><p className="text-xs text-cocoa-500">Fair {formatMoney({ amount: deal.fairLowUsd, currency: "USD" })}–{formatMoney({ amount: deal.fairHighUsd, currency: "USD" })}</p></> : <><p className="font-semibold text-cocoa-500">Insufficient</p><p className="text-xs text-cocoa-400">No discount calculated</p></>}
      </td>}
      <td className="px-3 py-4"><p className="font-semibold">{formatMoney(watch.landedPrice ?? watch.price)}</p><p className="text-xs text-cocoa-500">{watch.landedPrice ? "Landed" : watch.price ? "Tracked" : "No price"}</p></td>
      <td className="px-3 py-4">
        {offer.status === "available" ? <><a href={offer.offer.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-azalea-700 hover:underline">{formatMoney(offer.offer.price)} ↗</a><p className="mt-1 text-xs text-cocoa-500">{offer.offer.source}</p><div className="mt-1"><FreshnessBadge tier={offer.offer.freshness} ageDays={offer.offer.ageDays} compact /></div></> : <p className="text-cocoa-500">No dated offer</p>}
      </td>
      <td className="px-3 py-4 text-xs"><p>{row.category ? titleCase(row.category) : "Category unrated"}</p><p className="text-cocoa-500">{watch.specs.caseDiameterMm ? `${watch.specs.caseDiameterMm} mm` : "Size unrated"}</p><p className="text-cocoa-500">{watch.specs.caliber ?? watch.specs.movement ?? "Movement unrated"}{movementTier !== undefined ? ` · tier ${Math.round(movementTier * 100)}` : ""}</p></td>
      <td className="px-3 py-4"><p className="font-semibold">{watch.designUniqueness ? `${watch.designUniqueness} / 5` : "Unrated"}</p>{summary.designScore !== null && <p className="text-xs text-cocoa-500">Score {Math.round(summary.designScore)}</p>}</td>
      <td className="px-3 py-4">{row.targetMet ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">Target met</span> : watch.targetPrice ? <span className="text-xs text-cocoa-500">Target {formatMoney(watch.targetPrice)}</span> : <span className="text-cocoa-400">—</span>}</td>
    </tr>
  );
}

function formatDiscount(discount: number): string {
  if (discount > 0.5) return `${Math.round(discount)}% below fair asks`;
  if (discount < -0.5) return `${Math.round(Math.abs(discount))}% above fair asks`;
  return "At fair median";
}
