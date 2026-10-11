import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { getWatches } from "@/lib/store";
import { standingSummaries } from "@/lib/scoring";
import { decideColumns, QUADRANT_LABELS, sellerSearchLinks, type DecideColumn } from "@/lib/decide";
import { MAX_FINALISTS } from "@/lib/finalists";
import { formatMoney } from "@/lib/format";
import { IS_STATIC } from "@/lib/config";
import FinalistToggle from "@/components/FinalistToggle";
import ListingEditor from "@/components/ListingEditor";

export const metadata = { title: "Decide" };

const usd = (amount: number) => formatMoney({ amount: Math.round(amount), currency: "USD" });

export default async function DecidePage() {
  if (!IS_STATIC) noStore();
  const watches = await getWatches();
  const columns = decideColumns(watches, standingSummaries(watches, watches));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Decide</h1>
        <p className="text-sm text-cocoa-500">
          Your finalists side by side, cheapest first. Each figure stands on its own; nothing here is combined into one score.
        </p>
      </div>

      {columns.length === 0 ? (
        <section className="card p-8 text-center">
          <p className="font-medium text-cocoa-800">Pin up to {MAX_FINALISTS} finalists to compare them here.</p>
          <p className="mt-1 text-sm text-cocoa-500">Use ☆ Finalist on a wishlist card or watch page.</p>
          <Link href="/" className="btn-secondary mt-4 inline-flex">Go to collection</Link>
        </section>
      ) : (
        <>
          <p className="text-sm text-cocoa-500">
            {columns.length} of {MAX_FINALISTS} finalists
          </p>
          <ol className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
            {columns.map((column) => <li key={column.watch.id} className="min-w-0"><Column column={column} /></li>)}
          </ol>
        </>
      )}
    </div>
  );
}

function Column({ column }: { column: DecideColumn }) {
  const { watch } = column;
  const name = `${watch.brand} ${watch.model}`;
  return (
    <article className="card flex h-full flex-col overflow-hidden">
      <Link href={`/watch/${watch.id}`} tabIndex={-1} aria-hidden className="flex h-40 items-center justify-center bg-gradient-to-br from-cocoa-100 to-cocoa-200">
        {watch.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={watch.imageUrl} alt="" className="h-full w-full object-cover" />
          : <span className="text-2xl font-bold text-cocoa-400">{watch.brand[0]}</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-cocoa-500">{watch.brand}</p>
          <Link href={`/watch/${watch.id}`} className="line-clamp-2 font-semibold leading-snug hover:underline">{watch.model}</Link>
        </div>

        <div>
          <p className="text-xl font-bold tabular-nums">{formatMoney(watch.price)}</p>
          <p className="text-xs text-cocoa-500">
            {column.targetMet
              ? <span className="font-semibold text-emerald-700">At target</span>
              : column.targetGapUsd !== undefined
                ? <>{usd(column.targetGapUsd)} above target</>
                : "No target"}
          </p>
        </div>

        {column.quadrant && (
          <p className="w-fit rounded-full bg-cocoa-100 px-2 py-0.5 text-xs text-cocoa-700" title="Against the collection's medians">
            {QUADRANT_LABELS[column.quadrant]}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-cocoa-100 pt-3 text-sm">
          <Figure label="Value" value={column.value} note={column.provisional ? "provisional" : undefined} />
          <Figure label="Quality" value={column.quality} />
          <Figure label="Design" value={column.design} />
          <Figure label="Fit" value={watch.personalFit} suffix="/5" />
          <Figure label="Evidence" value={Math.round(column.evidenceCoverage * 100)} suffix="%" />
          {column.deal && <div className="col-span-2"><dt className="text-xs text-cocoa-500">Deal</dt><dd className="font-semibold">{column.deal}</dd></div>}
        </dl>

        {column.frictions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {column.frictions.map((friction) => (
              <span key={friction} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">{friction}</span>
            ))}
          </div>
        )}

        {column.todos.length > 0 && (
          <div className="border-t border-cocoa-100 pt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cocoa-500">Would sharpen this</p>
            <ul className="space-y-1 text-sm">
              {column.todos.map((todo) => (
                <li key={todo.key}>
                  {todo.key === "second-seller" && column.sellers && !IS_STATIC
                    ? <SecondSeller column={column} />
                    : <Link href={todo.href} className="text-azalea-700 underline-offset-4 hover:underline">{todo.text}</Link>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!IS_STATIC && (
          <div className="mt-auto pt-1">
            <FinalistToggle watchId={watch.id} watchName={name} finalist />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The evidence the deal is waiting on, added without leaving Decide. The
 * listing editor is the one Market and Trade-up use; saving refreshes the
 * page, so the column recounts and shows the deal once two sellers count.
 */
function SecondSeller({ column }: { column: DecideColumn }) {
  const { watch, sellers } = column;
  if (!sellers) return null;
  return (
    <div className="space-y-1">
      <p className="text-cocoa-800">
        Another {sellers.condition} seller&apos;s price{" "}
        <span className="text-cocoa-500">({sellers.counted.length} of {sellers.counted.length + sellers.needed})</span>
      </p>
      <p className="text-xs text-cocoa-500">
        {sellers.counted.length
          ? <>Counts now: {sellers.counted.join(", ")}. Another site is needed; listings from one site count once.</>
          : <>No dated {sellers.condition} asks yet. Two sites are needed for a deal.</>}
      </p>
      <ListingEditor
        watchId={watch.id}
        watchLabel={`${watch.brand} ${watch.model}`}
        links={watch.links}
        condition={sellers.condition}
        label="Add a seller's price"
      />
      <p className="text-xs text-cocoa-500">
        Find one:{" "}
        {sellerSearchLinks(watch).map((link, index) => (
          <span key={link.label}>
            {index > 0 && " · "}
            <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-azalea-700 underline-offset-4 hover:underline">{link.label} ↗</a>
          </span>
        ))}
      </p>
    </div>
  );
}

function Figure({ label, value, suffix = "", note }: { label: string; value?: number; suffix?: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-cocoa-500">{label}</dt>
      <dd className={value === undefined ? "text-cocoa-400" : "font-semibold tabular-nums text-cocoa-900"}>
        {value === undefined ? "Unrated" : `${value}${suffix}`}
        {note && <span className="ml-1 text-xs font-normal text-amber-700">{note}</span>}
      </dd>
    </div>
  );
}
