"use client";

import { useId, useState } from "react";
import type { Money, Watch } from "@/lib/types";
import type { SaleListingView } from "@/lib/sale-store";
import { formatDate, formatMoney } from "@/lib/format";
import { netProceeds } from "@/lib/proceeds";
import { gradeInfo } from "@/lib/listing-text";
import { soldComps } from "@/lib/sold-comps";
import { IS_STATIC } from "@/lib/config";
import SaleListingForm from "./SaleListingForm";
import MarkSoldForm from "./MarkSoldForm";

const usd = (amount: number) => formatMoney({ amount, currency: "USD" });

const STATE_LABEL: Record<SaleListingView["state"], string> = {
  none: "Not listed",
  draft: "Draft · private",
  live: "Live",
  reserved: "Reserved",
};

/**
 * Sell or keep, local only. Everything a sale decision needs in one place:
 * the exit range, recorded sales of this model, brand
 * liquidity, your minimum, and net at your ask. The suggested ask comes only
 * from the exit range — your own ask never feeds it, or the "market" would
 * just quote you back to yourself. What you paid has its own panel beside
 * this one; it's passed in only for the mark-sold form.
 */
export default function SellPanel({ watch, view, purchase, exit }: {
  watch: Pick<Watch, "id" | "brand" | "model" | "referenceNumber" | "specs" | "imageUrl" | "soldComps" | "friction">;
  view: SaleListingView;
  purchase?: Money;
  /** Trade-up exit range; medianUsd undefined when evidence is insufficient. */
  exit?: { medianUsd?: number; lowUsd?: number; highUsd?: number; sources: number };
}) {
  const id = useId();
  const [mode, setMode] = useState<"closed" | "listing" | "sold">("closed");
  if (IS_STATIC) return null;

  const comps = soldComps(watch);
  const latest = comps[0];
  const ask = view.content?.askingPrice;
  // Estimate before shipping: the shipping cost isn't known until it sells,
  // so the label says it's excluded instead of guessing a number.
  const atAsk = ask ? netProceeds(ask, view.listingFees, { amount: 0, currency: ask.currency }) : undefined;
  const grade = view.content ? gradeInfo(view.content.grade) : undefined;

  return (
    <section className="card p-5" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-cocoa-950">Sell or keep</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${view.state === "live" ? "bg-azalea text-cocoa-950" : "bg-cocoa-100 text-cocoa-700"}`}>{STATE_LABEL[view.state]}</span>
      </div>
      <p className="mt-1 text-xs text-cocoa-500">Only on this computer. A draft stays private; a live listing appears on the For-sale page after you commit and push.</p>

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Exit range (pre-owned asks)</dt>
          <dd className="mt-1 text-cocoa-900">
            {exit?.medianUsd !== undefined && exit.lowUsd !== undefined && exit.highUsd !== undefined
              ? <>{usd(exit.medianUsd)} median · {usd(exit.lowUsd)}–{usd(exit.highUsd)}</>
              : <span className="text-cocoa-500">Not enough evidence ({exit?.sources ?? 0} of 2 sources)</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Recorded sales of this model</dt>
          <dd className="mt-1 text-cocoa-900">
            {latest ? <>{comps.length} · latest {formatMoney(latest.price)} on {formatDate(latest.soldAt)}</> : <span className="text-cocoa-500">None recorded</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Brand liquidity</dt>
          <dd className="mt-1 text-cocoa-900">{watch.friction?.brandLiquidity ? `${watch.friction.brandLiquidity} of 5` : <span className="text-cocoa-500">Not rated</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Your minimum</dt>
          <dd className="mt-1 text-cocoa-900">{view.minimumPrice ? formatMoney(view.minimumPrice) : <span className="text-cocoa-500">Not set</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">{ask ? "Net at your ask, before shipping" : "Suggested ask"}</dt>
          <dd className="mt-1 text-cocoa-900">
            {ask && atAsk
              ? atAsk.status === "known"
                ? <>{usd(atAsk.netUsd)} <span className="text-xs text-cocoa-500">from {formatMoney(ask)} − {usd(atAsk.costsUsd)} fees</span></>
                : <span className="text-cocoa-500">Unknown until you enter expected {atAsk.missing.join(", ")}</span>
              : exit?.medianUsd !== undefined
                ? <>{usd(exit.medianUsd)} <span className="text-xs text-cocoa-500">the exit median</span></>
                : <span className="text-cocoa-500">None until there is an exit range</span>}
          </dd>
        </div>
      </dl>

      {view.content && mode === "closed" && (
        <p className="mt-4 text-sm text-cocoa-600">
          {view.state === "draft" ? "Draft at" : "Listed at"} <span className="font-semibold text-cocoa-900">{formatMoney(view.content.askingPrice)}</span>
          {grade && <> · {grade.label}</>} · {view.content.photos.length} photo{view.content.photos.length === 1 ? "" : "s"}
        </p>
      )}

      {mode === "closed" && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="btn-primary min-h-11" onClick={() => setMode("listing")}>{view.state === "none" ? "Create listing" : "Edit listing"}</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => setMode("sold")}>Mark sold</button>
        </div>
      )}
      {mode === "listing" && (
        <SaleListingForm watch={watch} view={view} suggestedAskUsd={exit?.medianUsd} onClose={() => setMode("closed")} />
      )}
      {mode === "sold" && (
        <MarkSoldForm watchId={watch.id} revision={view.revision} ask={view.content?.askingPrice} grade={view.content?.grade} fees={view.listingFees} purchase={purchase} onClose={() => setMode("closed")} />
      )}
    </section>
  );
}
