"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CURRENCIES, type ConditionGrade, type Money } from "@/lib/types";
import { parseSoldFields, type SoldFields } from "@/lib/sale-entry";
import type { FeeLine } from "@/lib/proceeds";
import { netProceeds } from "@/lib/proceeds";
import { formatMoney } from "@/lib/format";
import { normalizeMoneyToUsd } from "@/lib/offer-signals.mjs";
import FeeLinesInput from "./FeeLinesInput";

const usd = (amount: number) => formatMoney({ amount, currency: "USD" });
const signed = (amount: number) => `${amount < 0 ? "−" : amount > 0 ? "+" : ""}${usd(Math.abs(amount))}`;

/**
 * Close a sale. The price, date and channel become public (and a recorded
 * sale of this model); fees, shipping and buyer stay in data/private.json.
 * The live preview shows net proceeds with every input, and says "unknown"
 * when a cost is missing rather than showing the gross as the net.
 */
export default function MarkSoldForm({ watchId, revision, ask, grade, fees, purchase, onClose }: {
  watchId: string;
  revision: string;
  ask?: Money;
  grade?: ConditionGrade;
  fees?: FeeLine[];
  purchase?: Money;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [fields, setFields] = useState<SoldFields>(() => ({
    amount: ask ? String(ask.amount) : "",
    currency: ask?.currency ?? "USD",
    date: new Date().toISOString().slice(0, 10),
    channel: "",
    // An unworn watch could count as either; make that a choice, not a guess.
    countAs: grade === "unworn" ? "" : "pre-owned",
    fees: (fees ?? []).map(fee => ({ label: fee.label, amount: fee.amount ? String(fee.amount.amount) : "" })),
    noFees: fees?.length === 0,
    shippingAmount: "",
    buyer: "",
    notes: "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof SoldFields>(key: K, value: SoldFields[K]) {
    setFields(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: "" }));
    setError("");
  }

  // Preview from whatever parses so far; fees left unconsidered count as unknown.
  const amount = Number(fields.amount);
  const gross = amount > 0 ? { amount, currency: fields.currency } : undefined;
  const feeLines: FeeLine[] | undefined = fields.fees.some(fee => fee.label || fee.amount)
    ? fields.fees.filter(fee => fee.label || fee.amount).map(fee => ({ label: fee.label || "a fee", ...(fee.amount !== "" && Number(fee.amount) >= 0 ? { amount: { amount: Number(fee.amount), currency: fields.currency } } : {}) }))
    : fields.noFees ? [] : undefined;
  const shipping = fields.shippingAmount !== "" && Number(fields.shippingAmount) >= 0 ? { amount: Number(fields.shippingAmount), currency: fields.currency } : undefined;
  const net = netProceeds(gross, feeLines, shipping);
  const paidUsd = normalizeMoneyToUsd(purchase);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseSoldFields(fields);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setError("Check the highlighted fields.");
      return;
    }
    if (!window.confirm("Mark this watch sold? It moves out of your collection and its listing closes.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/watches/${encodeURIComponent(watchId)}/sold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, revision }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.errors) setErrors(result.errors);
        if (response.status === 409) router.refresh();
        throw new Error(result.error || "Couldn't record the sale. Your entries are still here; try again.");
      }
      onClose();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't record the sale. Your entries are still here; try again.");
    } finally { setBusy(false); }
  }

  const err = (key: string) => errors[key] ? <p id={`${id}-${key}-error`} className="mt-1 text-sm text-red-700">{errors[key]}</p> : null;
  const aria = (key: string) => ({ "aria-invalid": Boolean(errors[key]), "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined });

  return (
    <form noValidate onSubmit={submit} className="mt-4 space-y-5 rounded-lg border border-cocoa-200 bg-cocoa-50 p-4">
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <div>
            <label htmlFor={`${id}-amount`} className="label">Sale price</label>
            <input id={`${id}-amount`} className="input min-h-11" inputMode="decimal" value={fields.amount} onChange={e => set("amount", e.target.value)} {...aria("amount")} />
            {err("amount")}
          </div>
          <div>
            <label htmlFor={`${id}-currency`} className="label">Currency</label>
            <select id={`${id}-currency`} className="input min-h-11" value={fields.currency} onChange={e => set("currency", e.target.value)} {...aria("currency")}>{CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select>
            {err("currency")}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-date`} className="label">Sold on</label>
            <input id={`${id}-date`} type="date" className="input min-h-11" value={fields.date} onChange={e => set("date", e.target.value)} {...aria("date")} />
            {err("date")}
          </div>
          <div>
            <label htmlFor={`${id}-channel`} className="label">Where</label>
            <input id={`${id}-channel`} className="input min-h-11" placeholder="Chrono24, r/Watchexchange, direct…" value={fields.channel} onChange={e => set("channel", e.target.value)} {...aria("channel")} />
            {err("channel")}
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-count`} className="label">Counts as a sale of a…</label>
          <select id={`${id}-count`} className="input min-h-11" value={fields.countAs} onChange={e => set("countAs", e.target.value)} {...aria("countAs")}>
            <option value="" disabled>Choose…</option>
            <option value="pre-owned">Pre-owned watch</option>
            <option value="new">New watch</option>
          </select>
          <p className="mt-1 text-xs text-cocoa-500">Your sale is saved as a recorded sale of this model — real evidence of what it sells for. The price and date are public.</p>
          {err("countAs")}
        </div>

        <FeeLinesInput id={id} fees={fields.fees} noFees={fields.noFees} errors={errors} currency={fields.currency} onChange={(fees, noFees) => { setFields(current => ({ ...current, fees, noFees })); setErrors({}); }} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-shipping`} className="label">Shipping cost ({fields.currency})</label>
            <input id={`${id}-shipping`} className="input min-h-11" inputMode="decimal" placeholder="Unknown" value={fields.shippingAmount} onChange={e => set("shippingAmount", e.target.value)} {...aria("shippingAmount")} />
            <p className="mt-1 text-xs text-cocoa-500">0 if the buyer paid it or it was free.</p>
            {err("shippingAmount")}
          </div>
          <div>
            <label htmlFor={`${id}-buyer`} className="label">Buyer (private, optional)</label>
            <input id={`${id}-buyer`} className="input min-h-11" value={fields.buyer} onChange={e => set("buyer", e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-notes`} className="label">Notes (private, optional)</label>
          <textarea id={`${id}-notes`} className="input min-h-20" value={fields.notes} onChange={e => set("notes", e.target.value)} {...aria("notes")} />
          {err("notes")}
        </div>

        <div className="rounded-md bg-white p-3 text-sm" aria-live="polite">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Net proceeds</h4>
          {net.status === "known" ? (
            <>
              <p className="mt-1 text-xl font-bold tabular-nums text-cocoa-950">{usd(net.netUsd)}</p>
              <p className="text-xs text-cocoa-500">{usd(net.grossUsd)} sale − {usd(net.costsUsd)} fees and shipping</p>
              {paidUsd !== undefined && <p className="mt-1 text-cocoa-700">{signed(net.netUsd - paidUsd)} vs the {usd(paidUsd)} you paid</p>}
            </>
          ) : (
            <p className="mt-1 text-cocoa-700">Unknown until you enter {net.missing.join(", ")}.</p>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-primary min-h-11">{busy ? "Saving…" : "Mark sold"}</button>
          <button type="button" className="btn-secondary min-h-11" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
