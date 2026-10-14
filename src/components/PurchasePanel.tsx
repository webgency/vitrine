"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENCIES } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { normalizeMoneyToUsd } from "@/lib/offer-signals.mjs";
import { parsePurchaseFields, purchaseFieldsFor, purchaseRevision, type PrivatePurchase, type PurchaseErrors, type PurchaseFields } from "@/lib/purchase-entry";
import { IS_STATIC } from "@/lib/config";

function usd(amount: number) {
  return formatMoney({ amount, currency: "USD" });
}

/**
 * What you paid, local only. The page passes it from data/private.json, and
 * this panel renders nothing in the static build: the Pages site must never
 * show or even receive a purchase price.
 *
 * Gain or loss is measured against the trade-up exit median, which is an
 * asking price — so it is labelled as before fees and before any discount.
 */
export default function PurchasePanel({ watchId, watchLabel, purchase, exitMedianUsd }: {
  watchId: string;
  watchLabel: string;
  purchase?: PrivatePurchase;
  /** From the trade-up exit range; undefined when the evidence is insufficient. */
  exitMedianUsd?: number;
}) {
  const router = useRouter();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(() => purchaseFieldsFor(purchase));
  const [revision, setRevision] = useState("");
  const [errors, setErrors] = useState<PurchaseErrors>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) amountInput.current?.focus(); }, [open]);

  if (IS_STATIC) return null;

  const paidUsd = purchase ? normalizeMoneyToUsd(purchase.price) : undefined;
  const difference = paidUsd !== undefined && exitMedianUsd !== undefined ? exitMedianUsd - paidUsd : undefined;

  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function change(key: keyof PurchaseFields, value: string) {
    setFields(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
    setError("");
  }
  async function send(body: object, message: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/watches/${encodeURIComponent(watchId)}/purchase`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, revision }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.errors) setErrors(result.errors);
        if (response.status === 409) router.refresh();
        throw new Error(result.error || "Couldn't save the purchase. Your draft is still here; try again.");
      }
      setSaved(message);
      close();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save the purchase. Your draft is still here; try again.");
    } finally { setBusy(false); }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePurchaseFields(fields);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      const first = Object.keys(parsed.errors)[0];
      requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
      return;
    }
    void send({ fields }, "Purchase saved.");
  }

  const field = (key: keyof PurchaseFields, label: string, input: React.ReactNode) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="label">{label}</label>
      {input}
      {errors[key] && <p id={`${id}-${key}-error`} className="mt-1 text-sm text-red-700">{errors[key]}</p>}
    </div>
  );
  const described = (key: keyof PurchaseFields) => ({
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined,
  });

  return (
    <section className="card p-5" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">What you paid</h2>
        <span className="text-xs text-cocoa-500">Private · this computer only</span>
      </div>

      {purchase ? (
        <div className="mt-2">
          <p className="text-2xl font-bold tabular-nums text-cocoa-950">{formatMoney(purchase.price)}</p>
          {(purchase.date || purchase.source) && (
            <p className="mt-1 text-sm text-cocoa-600">{[purchase.date && formatDate(purchase.date), purchase.source].filter(Boolean).join(" · ")}</p>
          )}
          {difference !== undefined ? (
            <p className="mt-2 text-sm text-cocoa-700">
              At the exit median ask ({usd(exitMedianUsd!)}): <span className="font-semibold tabular-nums">{difference < 0 ? "−" : difference > 0 ? "+" : ""}{usd(Math.abs(difference))}</span> vs what you paid.
              <span className="block text-xs text-cocoa-500">An asking price, before fees, shipping and any discount. {purchase.price.currency !== "USD" && "Converted at stored rates."}</span>
            </p>
          ) : (
            <p className="mt-2 text-xs text-cocoa-500">
              {paidUsd === undefined ? "No gain or loss: this currency can't be converted." : "No gain or loss until there is an exit estimate."}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-cocoa-600">Not recorded. It stays in <code>data/private.json</code>, which is never committed or published.</p>
      )}

      {!open && (
        <button ref={trigger} type="button" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-azalea-700 hover:underline" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => {
          setFields(purchaseFieldsFor(purchase)); setRevision(purchaseRevision(purchase)); setErrors({}); setError(""); setSaved(""); setOpen(true);
        }}>{purchase ? "Edit purchase" : "Record purchase"}</button>
      )}

      {open && (
        <form id={`${id}-form`} noValidate onSubmit={submit} className="mt-3 rounded-lg border border-cocoa-200 bg-cocoa-50 p-4">
          <h3 className="text-sm font-semibold text-cocoa-900">Purchase of {watchLabel}</h3>
          <p className="mt-1 text-xs text-cocoa-500">Saved to data/private.json on this computer only. Back that file up; git doesn&apos;t.</p>
          <fieldset disabled={busy} className="mt-3 space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              {field("amount", "Price paid", <input id={`${id}-amount`} ref={amountInput} className="input min-h-11" inputMode="decimal" value={fields.amount} onChange={e => change("amount", e.target.value)} {...described("amount")} />)}
              {field("currency", "Currency", <select id={`${id}-currency`} className="input min-h-11" value={fields.currency} onChange={e => change("currency", e.target.value)} {...described("currency")}>{CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {field("date", "Date (optional)", <input id={`${id}-date`} type="date" className="input min-h-11" value={fields.date} onChange={e => change("date", e.target.value)} {...described("date")} />)}
              {field("source", "Bought from (optional)", <input id={`${id}-source`} className="input min-h-11" value={fields.source} onChange={e => change("source", e.target.value)} {...described("source")} />)}
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="submit" className="btn-primary min-h-11">{busy ? "Saving…" : "Save purchase"}</button>
              {purchase && <button type="button" className="btn-secondary min-h-11" onClick={() => void send({ clear: true }, "Purchase cleared.")}>Clear purchase</button>}
              <button type="button" onClick={close} className="btn-secondary min-h-11">Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
      {saved && <p role="status" className="mt-2 text-sm text-cocoa-600">{saved}</p>}
    </section>
  );
}
