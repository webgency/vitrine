"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CURRENCIES,
  Condition,
  QualityFlags,
  RetailerLink,
  ScoringCategory,
  SCORING_CATEGORIES,
  Watch,
  WatchInput,
  WatchSpecs,
  WatchStatus,
  WATCH_STATUSES,
  WishlistTier,
  WISHLIST_TIERS,
  WISHLIST_TIER_LABELS,
} from "@/lib/types";
import {
  QUALITY_FLAG_FIELDS,
  QUALITY_FLAG_UNSET,
  SPEC_FIELDS,
  qualityFlagsFromForm,
  qualityFlagsToForm,
} from "@/lib/specs";
import { DIMENSION_LABELS } from "@/lib/rubrics";
import { hostname } from "@/lib/format";
import { cleanModelName } from "@/lib/model-name";
import { findDuplicates, type TrackedWatchKey } from "@/lib/duplicates";
import ImageDropzone from "./ImageDropzone";
import { emptyLinkRow, observedAtForSave, toLinkRow, type LinkRow } from "@/lib/link-rows";


// Derived from the field declarations so a flag added in specs.ts lands in the
// right group here without touching this file.
const FLAG_GROUPS: Array<{ title: string; fields: typeof QUALITY_FLAG_FIELDS }> = (() => {
  const groups: Array<{ title: string; fields: typeof QUALITY_FLAG_FIELDS }> = [];
  for (const field of QUALITY_FLAG_FIELDS) {
    const title = field.dimension ? `Feeds ${DIMENSION_LABELS[field.dimension]}` : "Recorded only";
    const existing = groups.find((g) => g.title === title);
    if (existing) existing.fields.push(field);
    else groups.push({ title, fields: [field] });
  }
  return groups;
})();

const SCORING_CATEGORY_LABELS: Record<ScoringCategory, string> = {
  diver: "Diver",
  chronograph: "Chronograph",
  gmt: "GMT / worldtimer",
  dress: "Dress / everyday",
  sports: "Sports / field",
};

function parseNum(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function payloadJson(payload: WatchInput): string {
  return JSON.stringify(payload, (_key, value) => (value === undefined ? null : value));
}

interface AutofillResult {
  brand?: string;
  model?: string;
  referenceNumber?: string;
  price?: { amount?: number; currency?: string };
  imageUrl?: string;
  specs?: Record<string, unknown>;
  tags?: string[];
  qualityFlags?: QualityFlags;
  retailer?: string;
  condition?: Condition;
  specsFound?: number;
  specsPossible?: number;
  coverageNote?: string;
}

export default function WatchForm({ initial, tracked }: {
  initial?: Watch;
  /** Watches already in the collection, for the duplicate warning when adding. */
  tracked?: TrackedWatchKey[];
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);

  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [referenceNumber, setReferenceNumber] = useState(initial?.referenceNumber ?? "");
  const [status, setStatus] = useState<WatchStatus>(initial?.status ?? "wishlist");
  // A new wishlist watch starts as watching, matching the tier migration that
  // moved unset wishlist watches there.
  const [wishlistTier, setWishlistTier] = useState<WishlistTier | "">(initial ? initial.wishlistTier ?? "" : "watching");
  const [scoringCategory, setScoringCategory] = useState<ScoringCategory | "">(initial?.scoringCategory ?? "");
  const [designUniqueness, setDesignUniqueness] = useState(initial?.designUniqueness != null ? String(initial.designUniqueness) : "");
  const [personalFit, setPersonalFit] = useState(initial?.personalFit != null ? String(initial.personalFit) : "");
  const [priceAmount, setPriceAmount] = useState(initial?.price?.amount != null ? String(initial.price.amount) : "");
  const [priceCurrency, setPriceCurrency] = useState(initial?.price?.currency ?? "USD");
  const [targetAmount, setTargetAmount] = useState(initial?.targetPrice?.amount != null ? String(initial.targetPrice.amount) : "");
  const [targetCurrency, setTargetCurrency] = useState(initial?.targetPrice?.currency ?? "USD");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [tags, setTags] = useState(initial?.tags?.join(", ") ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [specs, setSpecs] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    for (const f of SPEC_FIELDS) {
      const v = initial?.specs?.[f.key];
      s[f.key] = v != null ? String(v) : "";
    }
    return s;
  });
  // Flags are held as strings so a blank stays distinguishable from a recorded
  // false. The conversions both ways live in specs.ts, where that distinction
  // is unit-tested.
  const [flags, setFlags] = useState<Record<string, string>>(() => qualityFlagsToForm(initial?.qualityFlags));
  const [links, setLinks] = useState<LinkRow[]>(
    initial?.links?.length ? initial.links.map(toLinkRow) : [emptyLinkRow()]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);
  // The page title autofill shortened, kept so the original is one click away.
  const [scrapedModel, setScrapedModel] = useState<string | null>(null);
  const [duplicateAck, setDuplicateAck] = useState(false);
  const duplicateRef = useRef<HTMLDivElement>(null);
  const duplicates = useMemo(
    () => isEdit || !tracked ? [] : findDuplicates({ brand, referenceNumber, urls: [fetchUrl, ...links.map((link) => link.url)] }, tracked),
    [isEdit, tracked, brand, referenceNumber, fetchUrl, links]
  );
  const [specsOpen, setSpecsOpen] = useState(
    Boolean(initial && Object.values(initial.specs).some((value) => value !== undefined && value !== ""))
  );
  const [qualityOpen, setQualityOpen] = useState(Boolean(initial?.qualityFlags));
  const [linksOpen, setLinksOpen] = useState(Boolean(initial?.links?.length));
  const [notesOpen, setNotesOpen] = useState(Boolean(initial?.notes));

  function setLink(i: number, patch: Partial<LinkRow>) {
    setLinks((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function autofillFromUrl(urlOverride?: string) {
    const url = (urlOverride ?? fetchUrl).trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setFetchMsg("Enter a full http(s) link.");
      return;
    }

    setFetching(true);
    setFetchMsg(null);
    setFetchUrl(url);
    try {
      const res = await fetch("/api/watches/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as AutofillResult & { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't fetch that page.");

      const filled: string[] = [];
      if (data.brand) {
        setBrand(data.brand);
        filled.push("brand");
      }
      if (data.model) {
        // Propose a name without the brand, reference, size or "Watch" the
        // title carried for search engines; the original stays one click away.
        const diameter = Number(data.specs?.caseDiameterMm);
        const cleaned = cleanModelName(data.model, {
          brand: data.brand || brand,
          referenceNumber: data.referenceNumber || referenceNumber,
          caseDiameterMm: Number.isFinite(diameter) && diameter > 0 ? diameter : undefined,
        });
        setModel(cleaned);
        setScrapedModel(cleaned === data.model.trim() ? null : data.model);
        filled.push("model");
      }
      if (data.referenceNumber) {
        setReferenceNumber(data.referenceNumber);
        filled.push("ref");
      }
      if (data.imageUrl) {
        setImageUrl(data.imageUrl);
        filled.push("image");
      }
      if (data.price?.amount) {
        setPriceAmount(String(data.price.amount));
        if (data.price.currency) setPriceCurrency(data.price.currency);
        filled.push("price");
      }

      const specCount = data.specs ? Object.keys(data.specs).length : 0;
      if (specCount) {
        setSpecsOpen(true);
        setSpecs((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(data.specs ?? {})) next[key] = String(value);
          return next;
        });
        filled.push(data.specsPossible ? `${specCount} of ${data.specsPossible} specs` : `${specCount} spec${specCount > 1 ? "s" : ""}`);
      }
      if (data.tags?.length) {
        setTags((current) => Array.from(new Set([
          ...current.split(",").map((tag) => tag.trim()).filter(Boolean),
          ...data.tags!,
        ])).join(", "));
        filled.push(`${data.tags.length} category tag${data.tags.length > 1 ? "s" : ""}`);
      }
      if (data.qualityFlags && Object.keys(data.qualityFlags).length) {
        setFlags((current) => ({ ...current, ...qualityFlagsToForm(data.qualityFlags) }));
        setQualityOpen(true);
        filled.push("quality evidence");
      }

      setLinks((rows) => {
        const observedAt = data.price?.amount ? new Date().toISOString().slice(0, 10) : "";
        if (rows.some((row) => row.url.trim() === url)) {
          return rows.map((row) => row.url.trim() === url ? {
            ...row,
            retailer: data.retailer || row.retailer || hostname(url),
            priceAmount: data.price?.amount ? String(data.price.amount) : row.priceAmount,
            priceCurrency: data.price?.currency || row.priceCurrency,
            condition: data.condition || row.condition,
            observedAt: observedAt || row.observedAt,
            // A fresh price from the page is a new observation, not the stored one.
            ...(observedAt ? { storedObservedAt: undefined } : {}),
          } : row);
        }
        const row: LinkRow = {
          url,
          retailer: data.retailer || hostname(url),
          priceAmount: data.price?.amount ? String(data.price.amount) : "",
          priceCurrency: data.price?.currency || "USD",
          condition: data.condition || "",
          observedAt,
        };
        return rows[0]?.url.trim() ? [...rows, row] : [row, ...rows.slice(1)];
      });
      setLinksOpen(true);

      // Say when autofill is partial. A few filled fields beside many blank
      // ones must not read as a complete scrape.
      const partial = data.coverageNote && data.specsPossible
        ? ` Partial autofill: only ${data.specsFound ?? 0} of ${data.specsPossible} spec fields could be read from this page's language or layout, so check the empty ones.`
        : "";
      setFetchMsg(
        filled.length
          ? `Filled ${filled.join(", ")}. Review everything below, then save.${partial}`
          : "Couldn't find much on that page. Fill it in manually."
      );
    } catch (err) {
      setFetchMsg(err instanceof Error ? err.message : "Couldn't fetch that page.");
    } finally {
      setFetching(false);
    }
  }

  function buildPayload(): WatchInput {
    const builtSpecs: WatchSpecs = {};
    for (const f of SPEC_FIELDS) {
      const raw = specs[f.key]?.trim() ?? "";
      if (raw === "") continue;
      if (f.type === "number") {
        const n = parseNum(raw);
        if (n !== undefined) (builtSpecs[f.key] as number) = n;
      } else {
        (builtSpecs[f.key] as string) = raw;
      }
    }

    const builtLinks: RetailerLink[] = links
      .filter((l) => l.url.trim() !== "")
      .map((l) => {
        const link: RetailerLink = { url: l.url.trim() };
        link.retailer = l.retailer.trim() || hostname(l.url.trim());
        const amount = parseNum(l.priceAmount);
        if (amount !== undefined) link.price = { amount, currency: l.priceCurrency };
        if (l.condition) link.condition = l.condition;
        const observedAt = observedAtForSave(l);
        if (observedAt) link.observedAt = observedAt;
        return link;
      });

    const design = parseNum(designUniqueness);
    const payload: WatchInput = {
      brand: brand.trim(),
      model: model.trim(),
      referenceNumber: referenceNumber.trim() || undefined,
      status,
      wishlistTier: wishlistTier || undefined,
      scoringCategory: scoringCategory || undefined,
      designUniqueness: design,
      personalFit: parseNum(personalFit),
      imageUrl: imageUrl.trim() || undefined,
      specs: builtSpecs,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes: notes.trim() || undefined,
      links: builtLinks,
    };
    if (initial && design !== initial.designUniqueness) {
      // Pairwise choices were made inside the previous appeal band, so changing
      // the anchored rating intentionally clears that refinement.
      payload.designPreferenceElo = undefined;
      payload.designComparisonCount = undefined;
    }
    // Undefined when nothing is recorded, which payloadJson sends as null and
    // the PATCH reads as "clear this" — same convention as targetPrice, so
    // unsetting the last flag removes the object instead of leaving it stale.
    payload.qualityFlags = qualityFlagsFromForm(flags);
    const amount = parseNum(priceAmount);
    if (amount !== undefined) payload.price = { amount, currency: priceCurrency };
    // Sent as null when cleared so the PATCH removes an existing target rather
    // than silently keeping it.
    const target = parseNum(targetAmount);
    payload.targetPrice = target !== undefined ? { amount: target, currency: targetCurrency } : undefined;
    return payload;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!brand.trim() || !model.trim()) {
      setError("Brand and model are required.");
      return;
    }
    // A warning, not a block: one confirmation and the watch is added anyway.
    if (duplicates.length > 0 && !duplicateAck) {
      duplicateRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      duplicateRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const payload = buildPayload();
      const res = await fetch(isEdit ? `/api/watches/${initial!.id}` : "/api/watches", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadJson(payload),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const saved = (await res.json()) as Watch;
      router.push(`/watch/${saved.id ?? initial!.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!isEdit && (
        <section className="card space-y-3 p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cocoa-500">Autofill from a link</h2>
            <p className="mt-1 text-xs text-cocoa-500">
              Paste a product or retailer URL and we&apos;ll try to fill the brand, price, image, and specs from the page.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input"
              value={fetchUrl}
              onChange={(e) => setFetchUrl(e.target.value)}
              placeholder="https://retailer.com/product"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  autofillFromUrl();
                }
              }}
            />
            <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => autofillFromUrl()} disabled={fetching}>
              {fetching ? "Fetching..." : "Fetch details"}
            </button>
          </div>
          {fetchMsg && <p className="text-xs text-cocoa-600">{fetchMsg}</p>}
        </section>
      )}
      {isEdit && links.some((link) => link.url.trim()) && (
        <section className="card space-y-3 p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-cocoa-500">Refresh watch details</h2>
            <p className="mt-1 text-xs text-cocoa-500">
              Re-fetch a saved product page to update this form&apos;s brand, model, image, tracked price, and specifications. Review
              the changes below before saving. To check only a listing&apos;s asking price, use Check price in the Market section.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {links.filter((link) => link.url.trim()).map((link, index) => (
              <button
                key={`${link.url}-${index}`}
                type="button"
                className="btn-secondary"
                onClick={() => autofillFromUrl(link.url)}
                disabled={fetching}
              >
                {fetching && fetchUrl === link.url ? "Refreshing…" : `Refresh ${link.retailer || hostname(link.url)}`}
              </button>
            ))}
          </div>
          {fetchMsg && <p className="text-xs text-cocoa-600" role="status">{fetchMsg}</p>}
        </section>
      )}
      {duplicates.length > 0 && (
        <div ref={duplicateRef} tabIndex={-1} role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 outline-none">
          <p className="font-semibold">Already tracked?</p>
          <ul className="mt-1 space-y-1">
            {duplicates.map((match) => (
              <li key={match.id}>
                <a href={`/watch/${match.id}`} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-4 hover:underline">
                  {match.label} ↗
                </a>{" "}
                <span className="text-amber-800">· {match.reason === "same-page" ? "same product page" : "same brand and reference"}</span>
              </li>
            ))}
          </ul>
          {duplicateAck ? (
            <p className="mt-2 text-amber-800">It will be added as a separate watch.</p>
          ) : (
            <button type="button" className="mt-2 font-medium text-amber-900 underline underline-offset-4" onClick={() => setDuplicateAck(true)}>
              Add anyway
            </button>
          )}
        </div>
      )}
      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-cocoa-500">Basics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Brand *</label>
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="As written on the dial" />
          </div>
          <div>
            <label className="label">Model *</label>
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name, without the brand" />
            {scrapedModel && model !== scrapedModel && (
              <p className="mt-1 text-xs text-cocoa-500">
                Shortened from the page title &ldquo;{scrapedModel}&rdquo;.{" "}
                <button type="button" className="font-medium text-azalea-700 hover:underline" onClick={() => setModel(scrapedModel)}>
                  Use original
                </button>
              </p>
            )}
          </div>
          <div>
            <label className="label">Reference number</label>
            <input className="input" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as WatchStatus)}>
              {WATCH_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Priority · personal, never scored</label>
            <select className="input" value={wishlistTier} onChange={(e) => setWishlistTier(e.target.value as WishlistTier | "")}>
              {(status !== "wishlist" || wishlistTier === "") && <option value="">No priority</option>}
              {WISHLIST_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {WISHLIST_TIER_LABELS[tier]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Design appeal</label>
            <select className="input" value={designUniqueness} onChange={(e) => setDesignUniqueness(e.target.value)}>
              <option value="">No rating</option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-cocoa-400">1 leaves you cold; 5 is a design you would keep staring at.</p>
          </div>
          <div>
            <label className="label">Fit for me</label>
            <select className="input" value={personalFit} onChange={(e) => setPersonalFit(e.target.value)}>
              <option value="">Not rated</option>
              {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
            </select>
            <p className="mt-1 text-xs text-cocoa-400">Your firsthand fit rating. Personal only; it does not change specification value.</p>
          </div>
          <div>
            <label className="label">Value-scoring category</label>
            <select
              className="input"
              value={scoringCategory}
              onChange={(e) => setScoringCategory(e.target.value as ScoringCategory | "")}
            >
              <option value="">Infer from one category tag</option>
              {SCORING_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {SCORING_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-cocoa-400">
              Choose explicitly for hybrid watches. Ambiguous tags leave value unrated.
            </p>
          </div>
          <div>
            <label className="label">Tracked price</label>
            <div className="flex gap-2">
              <input className="input" inputMode="decimal" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} placeholder="5600" />
              <select className="input w-28" value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-xs text-cocoa-400">Changing this records a price-history entry.</p>
          </div>
          <div>
            <label className="label">Target price</label>
            <div className="flex gap-2">
              <input className="input" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="4800" />
              <select className="input w-28" value={targetCurrency} onChange={(e) => setTargetCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-xs text-cocoa-400">Flags the watch once the all-in price drops to this. Leave blank for none.</p>
          </div>
        </div>
        <div>
          <label className="label">Tags (comma-separated)</label>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="diver, GMT, blue dial" />
        </div>
        <div>
          <label className="label">Image</label>
          <ImageDropzone value={imageUrl} onChange={setImageUrl} />
        </div>
      </section>

      <details className="card group" open={specsOpen} onToggle={(event) => setSpecsOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold uppercase tracking-wide text-cocoa-500">Specifications</span>
            <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-cocoa-400">Dimensions, movement, materials, and functions</span>
          </span>
          <span className="text-xs font-medium text-cocoa-500 group-open:hidden">Show</span>
          <span className="hidden text-xs font-medium text-cocoa-500 group-open:inline">Hide</span>
        </summary>
        <div className="grid gap-4 border-t border-cocoa-100 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {SPEC_FIELDS.map((f) => (
            <div key={String(f.key)}>
              <label className="label">
                {f.label}
                {f.unit ? ` (${f.unit})` : ""}
              </label>
              {f.type === "select" ? (
                <select className="input" value={specs[f.key]} onChange={(e) => setSpecs((s) => ({ ...s, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  {f.options?.map((opt) => (
                    <option key={opt} value={opt} className="capitalize">
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  inputMode={f.type === "number" ? "decimal" : "text"}
                  value={specs[f.key]}
                  onChange={(e) => setSpecs((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>
      </details>

      <details className="card group" open={qualityOpen} onToggle={(event) => setQualityOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold uppercase tracking-wide text-cocoa-500">Quality evidence</span>
            <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-cocoa-400">Optional details that improve scoring confidence</span>
          </span>
          <span className="text-xs font-medium text-cocoa-500 group-open:hidden">Show</span>
          <span className="hidden text-xs font-medium text-cocoa-500 group-open:inline">Hide</span>
        </summary>
        <div className="space-y-4 border-t border-cocoa-100 p-5">
          <p className="text-xs text-cocoa-400">
            What the scoring engine reads for case features, bracelet, and regulation. Leave a field blank when
            you don&apos;t know — a dimension with nothing recorded stays unrated rather than scoring badly.
          </p>
          {FLAG_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="label">{group.title}</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((f) => (
                  <div key={String(f.key)}>
                    <label className="label">
                      {f.label}
                      {f.unit ? ` (${f.unit})` : ""}
                    </label>
                    {f.type === "boolean" ? (
                      <select
                        className="input"
                        value={flags[f.key]}
                        onChange={(e) => setFlags((s) => ({ ...s, [f.key]: e.target.value }))}
                      >
                      {/* Three options, not a checkbox: an unchecked box cannot
                          say whether the feature is absent or simply unchecked. */}
                      <option value={QUALITY_FLAG_UNSET}>— Not recorded</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                      </select>
                    ) : (
                      <input
                        className="input"
                        inputMode="decimal"
                        value={flags[f.key]}
                        placeholder="—"
                        onChange={(e) => setFlags((s) => ({ ...s, [f.key]: e.target.value }))}
                      />
                    )}
                    {f.hint ? <p className="mt-1 text-xs text-cocoa-400">{f.hint}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      <details className="card group" open={linksOpen} onToggle={(event) => setLinksOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold uppercase tracking-wide text-cocoa-500">Retailer links</span>
            <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-cocoa-400">Deal score needs 2 dated, same-condition links from different hostnames</span>
          </span>
          <span className="text-xs font-medium text-cocoa-500 group-open:hidden">Show</span>
          <span className="hidden text-xs font-medium text-cocoa-500 group-open:inline">Hide</span>
        </summary>
        <div className="space-y-4 border-t border-cocoa-100 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs text-cocoa-500">
              Add an independent AD, retailer, or public asking-price listing. The tracked headline price does not count as market evidence, and duplicate links from one hostname count once.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setLinks((rows) => [...rows, emptyLinkRow()])}
            >
              + Add link
            </button>
          </div>
          <div className="space-y-3">
            {links.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-cocoa-200 p-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input sm:col-span-2" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} placeholder="https://retailer.com/product" />
                <input className="input" value={l.retailer} onChange={(e) => setLink(i, { retailer: e.target.value })} placeholder="Retailer (optional)" />
                <div className="flex gap-2">
                  <input className="input" inputMode="decimal" value={l.priceAmount} onChange={(e) => setLink(i, { priceAmount: e.target.value, observedAt: l.observedAt || (e.target.value ? new Date().toISOString().slice(0, 10) : "") })} placeholder="Price" />
                  <select className="input w-24" value={l.priceCurrency} onChange={(e) => setLink(i, { priceCurrency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <select className="input" value={l.condition} onChange={(e) => setLink(i, { condition: e.target.value as LinkRow["condition"] })}>
                  <option value="">Condition…</option>
                  <option value="new">New</option>
                  <option value="pre-owned">Pre-owned</option>
                </select>
                <label className="text-xs text-cocoa-500">
                  <span className="mb-1 block">Price observed</span>
                  <input className="input" type="date" value={l.observedAt} onChange={(e) => setLink(i, { observedAt: e.target.value })} />
                </label>
              </div>
              <button type="button" className="btn-danger self-start" onClick={() => setLinks((rows) => rows.filter((_, idx) => idx !== i))} aria-label="Remove link">
                Remove
              </button>
            </div>
            ))}
          </div>
        </div>
      </details>

      <details className="card group" open={notesOpen} onToggle={(event) => setNotesOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-sm font-semibold uppercase tracking-wide text-cocoa-500">Notes</span>
            <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-cocoa-400">Optional context, observations, and deal history</span>
          </span>
          <span className="text-xs font-medium text-cocoa-500 group-open:hidden">Show</span>
          <span className="hidden text-xs font-medium text-cocoa-500 group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-cocoa-100 p-5">
          <label className="sr-only">Notes</label>
          <textarea className="input min-h-[6rem]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why you want it, condition observations, deal history…" />
        </div>
      </details>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add watch"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
