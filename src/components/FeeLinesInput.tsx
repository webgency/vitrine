"use client";

import type { FeeField } from "@/lib/sale-entry";

/** Fee lines with an explicit "none" choice. A line with a blank amount is
 * an unknown fee; no lines and no tick means fees weren't considered. Either
 * keeps net proceeds unknown rather than reading as zero. */
export default function FeeLinesInput({ id, fees, noFees, errors, currency, onChange }: {
  id: string;
  fees: FeeField[];
  noFees: boolean;
  errors: Record<string, string>;
  currency: string;
  onChange: (fees: FeeField[], noFees: boolean) => void;
}) {
  const update = (index: number, key: keyof FeeField, value: string) =>
    onChange(fees.map((fee, i) => (i === index ? { ...fee, [key]: value } : fee)), false);
  return (
    <fieldset className="space-y-2">
      <legend className="label">Fees ({currency})</legend>
      {fees.map((fee, index) => (
        <div key={index}>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
            <input aria-label={`Fee ${index + 1} name`} placeholder="e.g. PayPal G&S" className="input min-h-11" value={fee.label} onChange={e => update(index, "label", e.target.value)} />
            <input aria-label={`Fee ${index + 1} amount`} placeholder="Unknown" inputMode="decimal" className="input min-h-11" value={fee.amount} onChange={e => update(index, "amount", e.target.value)} aria-invalid={Boolean(errors[`fees.${index}`])} aria-describedby={errors[`fees.${index}`] ? `${id}-fee-${index}-error` : undefined} />
            <button type="button" className="btn-secondary min-h-11" aria-label={`Remove fee ${index + 1}`} onClick={() => onChange(fees.filter((_, i) => i !== index), false)}>×</button>
          </div>
          {errors[`fees.${index}`] && <p id={`${id}-fee-${index}-error`} className="mt-1 text-sm text-red-700">{errors[`fees.${index}`]}</p>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" className="min-h-11 text-sm font-medium text-azalea-700 hover:underline" onClick={() => onChange([...fees, { label: "", amount: "" }], false)}>+ Add fee</button>
        {fees.length === 0 && (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-cocoa-700">
            <input type="checkbox" checked={noFees} onChange={e => onChange([], e.target.checked)} /> No fees
          </label>
        )}
      </div>
      <p className="text-xs text-cocoa-500">Leave an amount blank if you don&apos;t know it yet; net proceeds then show as unknown, not as the full price.</p>
      {errors.fees && <p className="text-sm text-red-700">{errors.fees}</p>}
    </fieldset>
  );
}
