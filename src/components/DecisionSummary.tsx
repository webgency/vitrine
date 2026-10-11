import { computeDesignScore, toDisplayScore, type Standing } from "@/lib/scoring";
import { dealScore } from "@/lib/valuation";
import type { Watch } from "@/lib/types";
import { dealVerdict } from "@/lib/market-copy";

/**
 * What the decision panels concluded, in one quiet row under the price. The
 * full panels sit further down; this keeps their answers in view without
 * letting them outshout the name and price. Anything unscored says so in
 * words — a dash or a placeholder number would read as a result.
 */
export default function DecisionSummary({ watch, standing }: { watch: Watch; standing: Standing }) {
  const design = computeDesignScore(watch);
  const deal = dealScore(watch);

  const items: { key: string; label: string; value?: string; empty: string; title: string }[] = [
    {
      key: "value",
      label: "Rubric value",
      value: standing.valueScore === undefined ? undefined : String(Math.round(toDisplayScore(standing.valueScore))),
      empty: "Unrated",
      title: "Value against the rubric expectation at this price. 50 is expected.",
    },
    {
      key: "quality",
      label: "Quality",
      value: standing.qualityScore === undefined ? undefined : String(Math.round(toDisplayScore(standing.qualityScore))),
      empty: "Unrated",
      title: "Composite of the rated dimensions",
    },
    {
      key: "design",
      label: "Design",
      value: design === null ? undefined : String(Math.round(design)),
      empty: "Unrated",
      title: "Your design-appeal score",
    },
  ];
  // Deal earns a tile only once it can be computed. With one seller per watch
  // it read "Needs more data" on every page; Market explains what's missing.
  if (deal.status === "available") {
    items.splice(2, 0, {
      key: "deal",
      label: "Deal",
      value: dealVerdict(deal),
      empty: "",
      title: "Tracked price against independent, dated asking prices",
    });
  }
  if (watch.personalFit) {
    items.push({ key: "fit", label: "Fit", value: `${watch.personalFit}/5`, empty: "", title: "Your personal-fit rating" });
  }

  return (
    <div className="space-y-2">
      <dl className="flex flex-wrap gap-2">
        {items.map((item) => (
          <div key={item.key} title={item.title} className="min-w-[6.5rem] flex-auto rounded-lg border border-cocoa-100 bg-cocoa-50 px-3 py-2">
            <dt className="text-xs text-cocoa-500">{item.label}</dt>
            <dd
              className={`text-sm tabular-nums ${item.value === undefined ? "text-cocoa-400" : "font-semibold text-cocoa-800"}`}
            >
              {item.value ?? item.empty}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-cocoa-400">
        <a href="#standing" className="font-medium text-azalea-700 hover:underline">
          Standing details
        </a>
        <span className="text-cocoa-300"> · </span>
        <a href="#market" className="font-medium text-azalea-700 hover:underline">
          Market evidence
        </a>
        {watch.status === "owned" && (
          <>
            <span className="text-cocoa-300"> · </span>
            <a href="#trade-up" className="font-medium text-azalea-700 hover:underline">Trade-up</a>
          </>
        )}
      </p>
    </div>
  );
}
