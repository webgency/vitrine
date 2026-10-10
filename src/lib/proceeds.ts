import type { Money } from "./types";
import { normalizeMoneyToUsd } from "./offer-signals.mjs";

/** One cost taken out of a sale: a platform fee, a PayPal fee, a commission.
 * An `amount` left out means unknown — never zero. Zero is a stated amount. */
export interface FeeLine {
  label: string;
  amount?: Money;
}

export type NetProceeds =
  | { status: "known"; grossUsd: number; costsUsd: number; netUsd: number }
  | { status: "unknown"; grossUsd?: number; missing: string[] };

/**
 * Net proceeds, in USD, from a gross price and its costs.
 *
 * Proceeds are always net and always show their inputs: a fee or shipping
 * cost that hasn't been entered makes the net unknown rather than quietly
 * reporting the gross (the "missing data is never a zero" rule). `fees`
 * undefined means the fees haven't been considered at all; an empty list
 * means you said there were none. `shipping` undefined is unknown; a zero
 * amount is free or buyer-paid shipping.
 */
export function netProceeds(gross: Money | undefined, fees: FeeLine[] | undefined, shipping: Money | undefined): NetProceeds {
  const missing: string[] = [];
  const grossUsd = normalizeMoneyToUsd(gross);
  if (grossUsd === undefined) missing.push(gross ? "a convertible price" : "the price");
  if (fees === undefined) missing.push("fees");

  let costsUsd = 0;
  for (const fee of fees ?? []) {
    const usd = fee.amount ? (fee.amount.amount === 0 ? 0 : normalizeMoneyToUsd(fee.amount)) : undefined;
    if (usd === undefined) missing.push(fee.label || "a fee");
    else costsUsd += usd;
  }
  const shippingUsd = shipping ? (shipping.amount === 0 ? 0 : normalizeMoneyToUsd(shipping)) : undefined;
  if (shippingUsd === undefined) missing.push("shipping");
  else costsUsd += shippingUsd;

  if (missing.length || grossUsd === undefined) return { status: "unknown", ...(grossUsd !== undefined ? { grossUsd } : {}), missing };
  return { status: "known", grossUsd, costsUsd, netUsd: grossUsd - costsUsd };
}
