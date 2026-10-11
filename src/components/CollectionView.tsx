"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCollectionView, useComparisonSelection } from "@/hooks/useResearchSession";
import type { CollectionSort } from "@/lib/research-state";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Watch,
  WatchStatus,
  WATCH_STATUSES,
  WishlistTier,
  WISHLIST_TIERS,
  WISHLIST_TIER_LABELS,
} from "@/lib/types";
import { IS_STATIC } from "@/lib/config";
import { landedPriceUsd, type StandingSummary } from "@/lib/scoring";
import { bestOffer, FreshnessTier } from "@/lib/valuation";
import { useCollectionSearch } from "./CollectionSearchContext";
import { matchesWatchSearch } from "@/lib/watch-search";
import CollectionTable from "./CollectionTable";
import WatchCard from "./WatchCard";

type SortKey = CollectionSort;

const STATUS_LABELS: Record<WatchStatus | "all", string> = { all: "All", wishlist: "Wishlist", owned: "Owned", sold: "Sold" };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "wishlistTier", label: "Wishlist priority" },
  { key: "valueScore", label: "Rubric value" },
  { key: "qualityScore", label: "Quality score" },
  { key: "offerFreshness", label: "Best-offer freshness" },
  { key: "dateAdded", label: "Recently added" },
  { key: "priceAsc", label: "Price: low to high" },
  { key: "priceDesc", label: "Price: high to low" },
  { key: "brand", label: "Brand A–Z" },
  { key: "caseSize", label: "Case size" },
];

/** Sort key for an optional score. Unrated sorts last; -1 rather than -Infinity
 *  so that two unrated watches subtract to 0 and fall through to the tiebreak
 *  instead of producing NaN. */
function rank(score: number | null | undefined): number {
  return score ?? -1;
}

function tierRank(tier?: WishlistTier): number {
  if (!tier) return Infinity;
  const index = WISHLIST_TIERS.indexOf(tier);
  return index === -1 ? Infinity : index;
}

const FRESHNESS_RANK: Record<FreshnessTier, number> = {
  fresh: 0,
  aging: 1,
  stale: 2,
  expired: 3,
};

export default function CollectionView({
  watches,
  scoreSummaries = {},
}: {
  watches: Watch[];
  scoreSummaries?: Record<string, StandingSummary>;
}) {
  const router = useRouter();
  const { query, filters, update } = useCollectionSearch();
  const { status, wishlistTiers, freshOffersOnly, sort } = filters;
  const [view, setView] = useCollectionView();
  const [priorityOpen, setPriorityOpen] = useState(false);
  // Phone only: priority, fresh-only and sort fold behind one button so the
  // first watch is on the first screen. From sm up the row is always shown.
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selected, setSelected] = useComparisonSelection(watches.map(watch => watch.id));
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const selectedTierSet = useMemo(() => new Set(wishlistTiers), [wishlistTiers]);
  const offerByWatch = useMemo(() => {
    const now = new Date();
    return new Map(watches.map((watch) => [watch.id, bestOffer(watch, undefined, now)]));
  }, [watches]);
  const priorityLabel = useMemo(() => {
    if (wishlistTiers.length === 0 || wishlistTiers.length === WISHLIST_TIERS.length) return "All priorities";
    if (wishlistTiers.length === 1) return WISHLIST_TIER_LABELS[wishlistTiers[0]];
    return `${wishlistTiers.length} priorities`;
  }, [wishlistTiers]);

  const priorityRef = useRef<HTMLDivElement>(null);
  const priorityTriggerRef = useRef<HTMLButtonElement>(null);

  // The panel is multi-select, so it stays open while the user ticks boxes and
  // closes only on an explicit dismissal. pointerdown rather than click so a
  // drag that starts outside still counts, and so the trigger's own click
  // toggles instead of racing a close.
  useEffect(() => {
    if (!priorityOpen) return;
    function dismissOnOutsidePointer(event: PointerEvent) {
      if (!priorityRef.current?.contains(event.target as Node)) setPriorityOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPriorityOpen(false);
      priorityTriggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [priorityOpen]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectionMessage(null);
      } else if (next.size < 4) {
        next.add(id);
        setSelectionMessage(null);
      } else {
        setSelectionMessage("Compare up to four watches at a time.");
      }
      return next;
    });
  }

  function resetFilters() {
    update({ status: "all", wishlistTiers: [], freshOffersOnly: false, query: "" });
  }

  async function changeWishlistTier(id: string, next: WishlistTier | "") {
    try {
      const res = await fetch(`/api/watches/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wishlistTier: next || null }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
      return true;
    } catch {
      return false;
    }
  }

  function toggleWishlistTier(tier: WishlistTier) {
    update({ wishlistTiers: wishlistTiers.includes(tier) ? wishlistTiers.filter(item => item !== tier) : [...wishlistTiers, tier] });
  }

  const filtered = useMemo(() => {
    let list = watches.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (selectedTierSet.size > 0 && (!w.wishlistTier || !selectedTierSet.has(w.wishlistTier))) return false;
      if (freshOffersOnly) {
        const offer = offerByWatch.get(w.id);
        if (offer?.status !== "available" || offer.offer.freshness !== "fresh") return false;
      }
      return matchesWatchSearch(w, query, [scoreSummaries[w.id]?.standing.peerLabel ?? ""]);
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case "wishlistTier":
          return tierRank(a.wishlistTier) - tierRank(b.wishlistTier) || b.dateAdded.localeCompare(a.dateAdded);
        case "valueScore":
          return (
            rank(scoreSummaries[b.id]?.standing.valueScore) - rank(scoreSummaries[a.id]?.standing.valueScore) ||
            rank(scoreSummaries[b.id]?.designScore) - rank(scoreSummaries[a.id]?.designScore) ||
            b.dateAdded.localeCompare(a.dateAdded)
          );
        case "qualityScore":
          return (
            rank(scoreSummaries[b.id]?.standing.qualityScore) - rank(scoreSummaries[a.id]?.standing.qualityScore) ||
            b.dateAdded.localeCompare(a.dateAdded)
          );
        case "offerFreshness": {
          const offerA = offerByWatch.get(a.id);
          const offerB = offerByWatch.get(b.id);
          const rankA = offerA?.status === "available" ? FRESHNESS_RANK[offerA.offer.freshness] : Infinity;
          const rankB = offerB?.status === "available" ? FRESHNESS_RANK[offerB.offer.freshness] : Infinity;
          const ageA = offerA?.status === "available" ? offerA.offer.ageDays : Infinity;
          const ageB = offerB?.status === "available" ? offerB.offer.ageDays : Infinity;
          return rankA - rankB || ageA - ageB || b.dateAdded.localeCompare(a.dateAdded);
        }
        case "priceAsc":
          return (landedPriceUsd(a) ?? Infinity) - (landedPriceUsd(b) ?? Infinity);
        case "priceDesc":
          return (landedPriceUsd(b) ?? -Infinity) - (landedPriceUsd(a) ?? -Infinity);
        case "brand":
          return `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`);
        case "caseSize":
          return (a.specs.caseDiameterMm ?? Infinity) - (b.specs.caseDiameterMm ?? Infinity);
        case "dateAdded":
        default:
          return b.dateAdded.localeCompare(a.dateAdded);
      }
    });
    return list;
  }, [watches, query, status, selectedTierSet, freshOffersOnly, offerByWatch, sort, scoreSummaries]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: watches.length };
    for (const s of WATCH_STATUSES) c[s] = watches.filter((w) => w.status === s).length;
    return c;
  }, [watches]);

  const wishlistTierCounts = useMemo(() => {
    const c = Object.fromEntries(WISHLIST_TIERS.map((tier) => [tier, 0])) as Record<WishlistTier, number>;
    for (const watch of watches) {
      if (watch.wishlistTier) c[watch.wishlistTier] += 1;
    }
    return c;
  }, [watches]);


  function startCompare() {
    if (selected.size < 2) return;
    // Selection survives filtering, so use the source collection rather than
    // the currently visible subset when building the comparison URL.
    const ids = watches.filter((w) => selected.has(w.id)).map((w) => w.id);
    router.push(`/compare?ids=${ids.join(",")}`);
  }

  const hasActiveFilters = status !== "all" || wishlistTiers.length > 0 || freshOffersOnly || query.trim() !== "";
  // Counted on the folded phone button so a hidden filter is never a silent one.
  const toolFilterCount = (wishlistTiers.length > 0 ? 1 : 0) + (freshOffersOnly ? 1 : 0);

  if (watches.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-4 p-12 text-center">
        <span className="text-4xl">⌚</span>
        <div>
          <h2 className="text-lg font-semibold">No watches yet</h2>
          <p className="text-sm text-cocoa-500">Add your first watch to start tracking and comparing.</p>
        </div>
        {!IS_STATIC && (
          <Link href="/watch/new" className="btn-primary">
            + Add your first watch
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Two rows at every width: what to show (status), then how to narrow and
          order it. One card, one control height, one pill radius, so the rows
          align instead of merging into a ragged single line on wide screens. */}
      <div className="card space-y-3 p-3">
        <div role="group" aria-label="Watch status" className="flex flex-wrap gap-2">
          {(["all", ...WATCH_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => update({ status: s })}
              aria-pressed={status === s}
              className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition-colors ${
                status === s ? "bg-azalea text-cocoa-950 ring-azalea" : "bg-white text-cocoa-600 ring-cocoa-200 hover:bg-cocoa-50"
              }`}
            >
              {STATUS_LABELS[s]}
              <span className={`tabular-nums ${status === s ? "" : "text-cocoa-400"}`}>{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={toolsOpen}
          aria-controls="collection-tools"
          onClick={() => setToolsOpen((current) => !current)}
          className="flex h-9 w-full items-center justify-between rounded-full bg-white px-4 text-sm text-cocoa-700 ring-1 ring-inset ring-cocoa-200 sm:hidden"
        >
          <span>Filters and sort{toolFilterCount > 0 ? ` (${toolFilterCount})` : ""}</span>
          <span aria-hidden>{toolsOpen ? "−" : "+"}</span>
        </button>
        <div
          id="collection-tools"
          className={`${toolsOpen ? "grid" : "hidden"} grid-cols-2 items-center gap-2 border-t border-cocoa-100 pt-3 sm:flex sm:flex-wrap`}
        >
          <div ref={priorityRef} className="relative min-w-0 sm:w-52">
            <button
              type="button"
              ref={priorityTriggerRef}
              onClick={() => setPriorityOpen((current) => !current)}
              aria-expanded={priorityOpen}
              aria-haspopup="true"
              className="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-full bg-white px-4 text-left text-sm text-cocoa-700 ring-1 ring-inset ring-cocoa-200 transition-colors hover:bg-cocoa-50"
            >
              <span className="truncate">{priorityLabel}</span>
              <span aria-hidden className={`text-cocoa-400 transition-transform ${priorityOpen ? "rotate-180" : ""}`}>
                &#9662;
              </span>
            </button>
            {priorityOpen && (
              <div
                role="group"
                aria-label="Priority"
                className="absolute z-20 mt-2 w-64 rounded-lg border border-cocoa-200 bg-white p-3 text-sm shadow-lg"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Priority</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-cocoa-500 hover:text-cocoa-900"
                    onClick={() => update({ wishlistTiers: [] })}
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-1">
                  {WISHLIST_TIERS.map((tier) => (
                    <label
                      key={tier}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-cocoa-50"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedTierSet.has(tier)}
                          onChange={() => toggleWishlistTier(tier)}
                          className="h-4 w-4 accent-cocoa-900"
                        />
                        <span>{WISHLIST_TIER_LABELS[tier]}</span>
                      </span>
                      <span className="text-xs text-cocoa-400">{wishlistTierCounts[tier]}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-pressed={freshOffersOnly}
            onClick={() => update({ freshOffersOnly: !freshOffersOnly })}
            // Azalea like every other selected control. Green would read as a
            // verdict about the offers rather than a filter that is switched on.
            className={`h-9 whitespace-nowrap rounded-full px-4 text-sm font-medium ring-1 ring-inset transition-colors ${
              freshOffersOnly
                ? "bg-azalea text-cocoa-950 ring-azalea"
                : "bg-white text-cocoa-600 ring-cocoa-200 hover:bg-cocoa-50"
            }`}
          >
            Fresh offers only
          </button>
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value as SortKey })}
            aria-label="Sort collection"
            className="input col-span-2 h-9 min-w-0 rounded-full py-0 pl-4 sm:ml-auto sm:w-auto"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-cocoa-500">
          <p role="status">
            Showing <span className="font-semibold text-cocoa-700">{filtered.length}</span> of {watches.length} watches
          </p>
          {hasActiveFilters && filtered.length > 0 && (
            <button type="button" className="font-medium text-cocoa-700 underline-offset-4 hover:underline" onClick={resetFilters}>
              Clear search and filters
            </button>
          )}
        </div>
        <div role="group" aria-label="Collection view" className="flex w-fit gap-1 rounded-full bg-cocoa-100 p-1">
          {(["grid", "table"] as const).map(mode => (
            <button type="button" key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}
              className={`h-8 rounded-full px-3.5 text-sm font-medium transition-colors ${view === mode ? "bg-azalea text-cocoa-950" : "text-cocoa-600 hover:bg-white/70 hover:text-cocoa-900"}`}>
              {mode === "grid" ? "Grid" : "Compact table"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-4 py-12 text-center">
          <p className="text-sm font-medium text-cocoa-700">No watches match your search and filters.</p>
          <p className="text-xs text-cocoa-500">Clear them to return to the full collection.</p>
          <button type="button" className="btn-secondary" onClick={resetFilters}>Clear search and filters</button>
        </div>
      ) : view === "table" ? (
        <CollectionTable watches={filtered} selected={selected} scoreSummaries={scoreSummaries}
          onToggleSelect={toggleSelect} onChangeWishlistTier={IS_STATIC ? undefined : changeWishlistTier} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              selected={selected.has(watch.id)}
              selectionDisabled={!selected.has(watch.id) && selected.size >= 4}
              scoreSummary={scoreSummaries[watch.id]}
              onToggleSelect={toggleSelect}
              onChangeWishlistTier={IS_STATIC ? undefined : changeWishlistTier}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30 mx-auto w-fit max-w-full rounded-2xl bg-cocoa-900 px-4 py-3 text-sm text-white shadow-xl sm:rounded-full sm:px-5">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span>{selected.size} of 4 selected{selected.size < 2 ? " · choose one more" : ""}</span>
            <button onClick={startCompare} disabled={selected.size < 2} className="rounded-full bg-white px-3 py-1 font-medium text-cocoa-900 disabled:opacity-50">
              Compare →
            </button>
            <button
              onClick={() => {
                setSelected(new Set());
                setSelectionMessage(null);
              }}
              className="text-cocoa-300 hover:text-white"
            >
              Clear
            </button>
          </div>
          {(selected.size === 4 || selectionMessage) && (
            <p id="comparison-limit" className="mt-1 text-center text-xs text-white" role="status">
              {selected.size === 4 ? "Four watches selected. Deselect one to choose another." : selectionMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
