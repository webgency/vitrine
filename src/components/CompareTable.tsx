import Link from "next/link";
import { Watch } from "@/lib/types";
import { SPEC_FIELDS, formatSpecValue } from "@/lib/specs";
import { formatMoney } from "@/lib/format";
import StatusBadge from "./StatusBadge";
import WishlistTierBadge from "./WishlistTierBadge";
import { landedPriceUsd } from "@/lib/scoring";
import { bestOffer } from "@/lib/valuation";
import FreshnessBadge from "./FreshnessBadge";
import { tagLabel } from "@/lib/categories";

/** Indexes of the "best" cells in a row, for highlighting. */
function bestIndexes(values: (number | undefined)[], prefer: "higher" | "lower"): Set<number> {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < 2) return new Set();
  const target = prefer === "higher" ? Math.max(...nums) : Math.min(...nums);
  const set = new Set<number>();
  values.forEach((v, i) => {
    if (v === target) set.add(i);
  });
  return set;
}

export default function CompareTable({ watches }: { watches: Watch[] }) {
  const priceBest = bestIndexes(
    watches.map((w) => landedPriceUsd(w)),
    "lower"
  );
  const now = new Date();
  const offers = watches.map((watch) => bestOffer(watch, undefined, now));
  const offerBest = bestIndexes(
    offers.map((result) => result.status === "available" ? result.offer.priceUsd : undefined),
    "lower"
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
        {/* Fixed layout + equal-width <col>s so every watch column is the same
            width regardless of content. First col is the row-label column. */}
        <colgroup>
          <col className="w-32 sm:w-40" />
          {watches.map((w) => (
            <col key={w.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-cocoa-50 p-3 text-left align-bottom" />
            {watches.map((w) => (
              <th key={w.id} className="border-b border-cocoa-200 p-3 text-left align-bottom">
                <div className="flex h-24 items-center justify-center rounded-lg bg-gradient-to-br from-cocoa-100 to-cocoa-200">
                  {w.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.imageUrl} alt={`${w.brand} ${w.model}`} className="h-full w-full rounded-lg object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-cocoa-400">
                      {(w.brand[0] ?? "?").toUpperCase()}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-cocoa-400">{w.brand}</p>
                <Link href={`/watch/${w.id}`} className="font-semibold hover:underline">
                  {w.model}
                </Link>
                <div className="mt-1 flex flex-wrap gap-1">
                  <StatusBadge status={w.status} />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Price" sticky>
            {watches.map((w, i) => (
              <Cell key={w.id} highlight={priceBest.has(i)}>
                <span className="font-semibold">{formatMoney(w.price)}</span>
              </Cell>
            ))}
          </Row>
          <Row label="Best dated offer" sticky>
            {offers.map((result, i) => (
              <Cell key={watches[i].id} highlight={offerBest.has(i)}>
                {result.status === "available" ? (
                  <div className="space-y-1">
                    <a href={result.offer.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-azalea-700 hover:underline">
                      {formatMoney(result.offer.price)} ↗
                    </a>
                    <p className="text-xs text-cocoa-500">
                      {result.offer.source} · <span className="capitalize">{result.offer.condition ?? "condition unknown"}</span>
                    </p>
                    <FreshnessBadge tier={result.offer.freshness} ageDays={result.offer.ageDays} compact />
                    {result.conditionMatch !== "matched" && (
                      <p className="text-xs text-amber-700">
                        {result.conditionMatch === "fallback" ? "Condition fallback" : "Condition unverified"}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-cocoa-400">
                    No dated offers{result.undatedOfferCount ? ` · ${result.undatedOfferCount} undated` : ""}
                  </span>
                )}
              </Cell>
            ))}
          </Row>
          {/* Kept as a labelled row, not a chip beside each name: priority is a
              personal filter, not a verdict on the comparison. */}
          <Row label="Priority · personal, not scored" sticky>
            {watches.map((w) => (
              <Cell key={w.id}>
                <WishlistTierBadge tier={w.wishlistTier} />
                {!w.wishlistTier && "—"}
              </Cell>
            ))}
          </Row>
          <Row label="Fit for me" sticky>
            {watches.map((w) => <Cell key={w.id}>{w.personalFit ? `${w.personalFit}/5` : "—"}</Cell>)}
          </Row>
          <Row label="Reference" sticky>
            {watches.map((w) => (
              <Cell key={w.id}>{w.referenceNumber || "—"}</Cell>
            ))}
          </Row>
          {SPEC_FIELDS.map((field) => {
            const values = watches.map((w) => w.specs[field.key]);
            const best =
              field.prefer && field.type === "number"
                ? bestIndexes(values as (number | undefined)[], field.prefer)
                : new Set<number>();
            return (
              <Row key={String(field.key)} label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`} sticky>
                {watches.map((w, i) => (
                  <Cell key={w.id} highlight={best.has(i)}>
                    {formatSpecValue(field, w.specs[field.key])}
                  </Cell>
                ))}
              </Row>
            );
          })}
          <Row label="Tags" sticky>
            {watches.map((w) => (
              <Cell key={w.id}>
                <div className="flex flex-wrap gap-1">
                  {w.tags.length ? (
                    w.tags.map((t) => (
                      <span key={t} className="rounded bg-cocoa-100 px-1.5 py-0.5 text-xs text-cocoa-600">
                        {tagLabel(t)}
                      </span>
                    ))
                  ) : (
                    "—"
                  )}
                </div>
              </Cell>
            ))}
          </Row>
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, sticky, children }: { label: string; sticky?: boolean; children: React.ReactNode }) {
  return (
    <tr className="even:bg-cocoa-50/60">
      <th
        scope="row"
        className={`p-3 text-left text-xs font-semibold uppercase tracking-wide text-cocoa-500 ${
          sticky ? "sticky left-0 z-10 bg-inherit" : ""
        }`}
      >
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ highlight, children }: { highlight?: boolean; children: React.ReactNode }) {
  return (
    <td className={`border-l border-cocoa-100 p-3 ${highlight ? "bg-emerald-50 font-medium text-emerald-900" : ""}`}>
      {children}
    </td>
  );
}
