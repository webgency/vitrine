"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENCIES, type Watch } from "@/lib/types";
import { COMMON_INCLUSIONS, CONDITION_GRADES, MAX_LISTING_PHOTOS } from "@/lib/listing-shape.mjs";
import { parseListingFields, type ListingFields } from "@/lib/sale-entry";
import type { SaleListingView } from "@/lib/sale-store";
import { draftListingText } from "@/lib/listing-text";
import { listingPhotoSrc } from "@/lib/listing-display";
import { fileToDataUrl } from "./ImageDropzone";
import FeeLinesInput from "./FeeLinesInput";

function initialFields(view: SaleListingView, suggestedAsk?: number): ListingFields {
  const content = view.content;
  const currency = content?.askingPrice.currency ?? "USD";
  return {
    state: view.state === "none" ? "draft" : view.state,
    askingAmount: content ? String(content.askingPrice.amount) : suggestedAsk ? String(Math.round(suggestedAsk)) : "",
    currency,
    grade: content?.grade ?? "",
    conditionNotes: content?.conditionNotes ?? "",
    included: content?.included ?? [],
    serviceHistory: content?.serviceHistory ?? "",
    description: content?.description ?? "",
    photos: content?.photos ?? [],
    postings: (content?.postings ?? []).map(posting => ({ platform: posting.platform, url: posting.url ?? "", amount: posting.askingPrice ? String(posting.askingPrice.amount) : "", postedAt: posting.postedAt })),
    minimumAmount: view.minimumPrice ? String(view.minimumPrice.amount) : "",
    fees: (view.listingFees ?? []).map(fee => ({ label: fee.label, amount: fee.amount ? String(fee.amount.amount) : "" })),
    noFees: view.listingFees?.length === 0,
  };
}

const STATE_HELP: Record<string, string> = {
  draft: "Private. Stays on this computer in data/private.json; nothing is committed or published.",
  live: "Public. Appears on the For-sale page and this watch's page once you commit and push.",
  reserved: "Public, marked Reserved, with no contact button.",
};

export default function SaleListingForm({ watch, view, suggestedAskUsd, onClose }: {
  watch: Pick<Watch, "id" | "brand" | "model" | "referenceNumber" | "specs" | "imageUrl">;
  view: SaleListingView;
  suggestedAskUsd?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState(() => initialFields(view, suggestedAskUsd));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newInclusion, setNewInclusion] = useState("");

  function set<K extends keyof ListingFields>(key: K, value: ListingFields[K]) {
    setFields(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: "" }));
    setError("");
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    try {
      const added = await Promise.all([...files].filter(file => file.type.startsWith("image/")).map(fileToDataUrl));
      set("photos", [...fields.photos, ...added].slice(0, MAX_LISTING_PHOTOS));
    } catch (failure) {
      setErrors(current => ({ ...current, photos: failure instanceof Error ? failure.message : "Couldn't read that image." }));
    }
  }

  async function send(body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/watches/${encodeURIComponent(watch.id)}/sale-listing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, revision: view.revision }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.errors) setErrors(result.errors);
        if (response.status === 409) router.refresh();
        throw new Error(result.error || "Couldn't save the listing. Your draft is still here; try again.");
      }
      onClose();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save the listing. Your draft is still here; try again.");
    } finally { setBusy(false); }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseListingFields(fields);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setError("Check the highlighted fields.");
      return;
    }
    void send({ fields });
  }

  function draftText() {
    const parsed = parseListingFields({ ...fields, state: "draft" });
    const asking = Number(fields.askingAmount);
    if (!fields.grade || !(asking > 0)) {
      setErrors(current => ({ ...current, description: "Choose a grade and an asking price first." }));
      return;
    }
    const content = parsed.ok ? parsed.value.content : { grade: fields.grade as never, included: fields.included, askingPrice: { amount: asking, currency: fields.currency } };
    set("description", draftListingText(watch, { ...content, conditionNotes: fields.conditionNotes || undefined, serviceHistory: fields.serviceHistory || undefined }));
  }

  const err = (key: string) => errors[key] ? <p id={`${id}-${key}-error`} className="mt-1 text-sm text-red-700">{errors[key]}</p> : null;
  const aria = (key: string) => ({ "aria-invalid": Boolean(errors[key]), "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined });
  const inclusionOptions = [...new Set([...COMMON_INCLUSIONS, ...fields.included])];

  return (
    <form noValidate onSubmit={submit} className="mt-4 space-y-5 rounded-lg border border-cocoa-200 bg-cocoa-50 p-4">
      <fieldset disabled={busy} className="space-y-5">
        <div>
          <span className="label">Status</span>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Listing status">
            {(["draft", "live", "reserved"] as const).map(state => (
              <label key={state} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold ${fields.state === state ? "border-cocoa-900 bg-cocoa-900 text-white" : "border-cocoa-200 bg-white text-cocoa-700"}`}>
                <input type="radio" className="sr-only" name={`${id}-state`} value={state} checked={fields.state === state} onChange={() => set("state", state)} />
                {state === "draft" ? "Draft" : state === "live" ? "Live" : "Reserved"}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-cocoa-500">{STATE_HELP[fields.state]}</p>
          {view.state !== "none" && view.state !== "draft" && fields.state === "draft" && (
            <p className="mt-1 text-xs text-cocoa-600">Moving back to draft removes the public listing and its photo files, but can&apos;t unpublish anything already pushed to GitHub.</p>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <div>
            <label htmlFor={`${id}-ask`} className="label">Asking price</label>
            <input id={`${id}-ask`} className="input min-h-11" inputMode="decimal" value={fields.askingAmount} onChange={e => set("askingAmount", e.target.value)} {...aria("askingAmount")} />
            {err("askingAmount")}
          </div>
          <div>
            <label htmlFor={`${id}-currency`} className="label">Currency</label>
            <select id={`${id}-currency`} className="input min-h-11" value={fields.currency} onChange={e => set("currency", e.target.value)} {...aria("currency")}>{CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select>
            {err("currency")}
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-minimum`} className="label">Your minimum (private, optional)</label>
          <input id={`${id}-minimum`} className="input min-h-11" inputMode="decimal" value={fields.minimumAmount} onChange={e => set("minimumAmount", e.target.value)} {...aria("minimumAmount")} />
          <p className="mt-1 text-xs text-cocoa-500">The lowest offer you&apos;d take. Kept in data/private.json; never shown publicly.</p>
          {err("minimumAmount")}
        </div>

        <FeeLinesInput id={id} fees={fields.fees} noFees={fields.noFees} errors={errors} currency={fields.currency} onChange={(fees, noFees) => { setFields(current => ({ ...current, fees, noFees })); setErrors({}); }} />

        <fieldset>
          <legend className="label">Condition</legend>
          <div className="mt-1 space-y-1">
            {CONDITION_GRADES.map(grade => (
              <label key={grade.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-white">
                <input type="radio" className="mt-1" name={`${id}-grade`} value={grade.id} checked={fields.grade === grade.id} onChange={() => set("grade", grade.id)} />
                <span><span className="text-sm font-semibold text-cocoa-900">{grade.label}</span> <span className="text-sm text-cocoa-600">{grade.definition}</span></span>
              </label>
            ))}
          </div>
          {err("grade")}
          <label htmlFor={`${id}-notes`} className="label mt-3">Condition notes (optional)</label>
          <textarea id={`${id}-notes`} className="input min-h-20" placeholder="e.g. Light hairline on the clasp; never polished." value={fields.conditionNotes} onChange={e => set("conditionNotes", e.target.value)} />
        </fieldset>

        <fieldset>
          <legend className="label">Included</legend>
          <div className="mt-1 flex flex-wrap gap-x-4">
            {inclusionOptions.map(item => (
              <label key={item} className="inline-flex min-h-11 items-center gap-2 text-sm text-cocoa-700">
                <input type="checkbox" checked={fields.included.includes(item)} onChange={e => set("included", e.target.checked ? [...fields.included, item] : fields.included.filter(i => i !== item))} />
                {item}
              </label>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            <input aria-label="Other included item" placeholder="Something else included" className="input min-h-11" value={newInclusion} onChange={e => setNewInclusion(e.target.value)} />
            <button type="button" className="btn-secondary min-h-11" onClick={() => { const item = newInclusion.trim(); if (item && !fields.included.includes(item)) set("included", [...fields.included, item]); setNewInclusion(""); }}>Add</button>
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-service`} className="label">Service history (optional, public)</label>
          <input id={`${id}-service`} className="input min-h-11" placeholder="e.g. Serviced by the brand in 2024" value={fields.serviceHistory} onChange={e => set("serviceHistory", e.target.value)} />
        </div>

        <div>
          <span className="label">Your photos</span>
          <p className="text-xs text-cocoa-500">Photograph this watch yourself. A shop&apos;s product image can&apos;t stand in for a used watch, so it isn&apos;t offered here.</p>
          {fields.photos.length > 0 && (
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {fields.photos.map((photo, index) => (
                <li key={index} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URLs and static-export paths */}
                  <img src={listingPhotoSrc(photo)} alt={`Listing photo ${index + 1}`} className="aspect-square w-full rounded-md object-cover" />
                  <button type="button" className="absolute right-1 top-1 h-8 w-8 rounded-full bg-white/90 text-sm font-bold text-cocoa-900 shadow" aria-label={`Remove photo ${index + 1}`} onClick={() => set("photos", fields.photos.filter((_, i) => i !== index))}>×</button>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" id={`${id}-photos`} onChange={e => { void addPhotos(e.target.files); e.target.value = ""; }} />
          <label htmlFor={`${id}-photos`} className="btn-secondary mt-2 inline-flex min-h-11 cursor-pointer items-center">Add photos</label>
          {err("photos")}
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor={`${id}-description`} className="label">Listing text</label>
            <button type="button" className="min-h-11 text-sm font-medium text-azalea-700 hover:underline" onClick={draftText}>Draft from specs</button>
          </div>
          <textarea id={`${id}-description`} className="input min-h-40 font-mono text-sm" value={fields.description} onChange={e => set("description", e.target.value)} {...aria("description")} />
          <p className="mt-1 text-xs text-cocoa-500">The draft uses only specs this watch has on record. Read it before publishing.</p>
          {err("description")}
        </div>

        <fieldset>
          <legend className="label">Also posted on (optional)</legend>
          <p className="text-xs text-cocoa-500">A record of where else it&apos;s listed. Your own asks never count as market prices.</p>
          {fields.postings.map((posting, index) => (
            <div key={index} className="mt-2 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_6rem_9rem_auto]">
              <input aria-label={`Posting ${index + 1} platform`} placeholder="Platform" className="input min-h-11" value={posting.platform} onChange={e => set("postings", fields.postings.map((p, i) => i === index ? { ...p, platform: e.target.value } : p))} />
              <input aria-label={`Posting ${index + 1} link`} placeholder="https://…" className="input min-h-11" value={posting.url} onChange={e => set("postings", fields.postings.map((p, i) => i === index ? { ...p, url: e.target.value } : p))} />
              <input aria-label={`Posting ${index + 1} price`} placeholder="Price" inputMode="decimal" className="input min-h-11" value={posting.amount} onChange={e => set("postings", fields.postings.map((p, i) => i === index ? { ...p, amount: e.target.value } : p))} />
              <input aria-label={`Posting ${index + 1} date`} type="date" className="input min-h-11" value={posting.postedAt} onChange={e => set("postings", fields.postings.map((p, i) => i === index ? { ...p, postedAt: e.target.value } : p))} />
              <button type="button" className="btn-secondary min-h-11" aria-label={`Remove posting ${index + 1}`} onClick={() => set("postings", fields.postings.filter((_, i) => i !== index))}>×</button>
              {errors[`postings.${index}`] && <p className="text-sm text-red-700 sm:col-span-5">{errors[`postings.${index}`]}</p>}
            </div>
          ))}
          <button type="button" className="mt-1 min-h-11 text-sm font-medium text-azalea-700 hover:underline" onClick={() => set("postings", [...fields.postings, { platform: "", url: "", amount: "", postedAt: new Date().toISOString().slice(0, 10) }])}>+ Add posting</button>
        </fieldset>

        {errors.form && <p className="text-sm text-red-700">{errors.form}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary min-h-11">{busy ? "Saving…" : fields.state === "draft" ? "Save draft" : "Save and publish"}</button>
          {view.state !== "none" && (
            <button type="button" className="btn-secondary min-h-11" onClick={() => { if (window.confirm("Withdraw this listing? The draft, photos and your minimum are removed.")) void send({ withdraw: true }); }}>Withdraw listing</button>
          )}
          <button type="button" className="btn-secondary min-h-11" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
