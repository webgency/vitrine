import EvidenceCoverage from "./EvidenceCoverage";
import { MIN_REFERENCE_COVERAGE, RUBRIC_TOLERANCE, Standing, unratedReason } from "@/lib/scoring";
import { DIMENSIONS, DIMENSION_BLURBS, DIMENSION_LABELS, type Dimension } from "@/lib/rubrics";
import { movementNote } from "@/lib/movement-notes";
import type { Watch } from "@/lib/types";

type Verdict = "beats" | "par" | "trails" | "limited" | "unbanded";

// Status encoding, not series identity. Every row also carries the verdict in
// words, so the colour never has to be read on its own — which is what lets the
// green/amber pair stand up under protanopia.
const VERDICT: Record<Verdict, { label: string; fill: string; track: string; text: string }> = {
  beats: {
    label: "Above expected",
    fill: "bg-emerald-600",
    track: "bg-emerald-100",
    text: "text-emerald-700",
  },
  par: {
    label: "As expected",
    fill: "bg-cocoa-500",
    track: "bg-cocoa-200",
    text: "text-cocoa-600",
  },
  trails: {
    label: "Below expected",
    fill: "bg-amber-600",
    track: "bg-amber-100",
    text: "text-amber-700",
  },
  limited: {
    label: "Limited evidence",
    fill: "bg-cocoa-400",
    track: "bg-cocoa-200",
    text: "text-cocoa-500",
  },
  // A watch with no price has no band, so there is no reference to be at, above
  // or below. Saying "As expected" there would be a claim the engine never made.
  unbanded: {
    label: "No benchmark",
    fill: "bg-cocoa-400",
    track: "bg-cocoa-200",
    text: "text-cocoa-400",
  },
};

/** 0-1 as a 0-100 integer. */
function pct(value: number): number {
  return Math.round(value * 100);
}

function verdictFor(dimension: Dimension, raw: number, reference: number | undefined, coverage: number): Verdict {
  if (reference === undefined) return "unbanded";
  if (coverage < MIN_REFERENCE_COVERAGE[dimension]) return "limited";
  if (raw > reference + RUBRIC_TOLERANCE) return "beats";
  if (raw < reference - RUBRIC_TOLERANCE) return "trails";
  return "par";
}

/**
 * A single dimension as a meter: fill to the score, a tick at the band's par.
 * The reader's question is "is this above or below what the money should buy",
 * so par has to be visible on the track rather than implied by the colour.
 */
function DimensionMeter({
  dimension,
  raw,
  reference,
  coverage,
  knownInputs,
  totalInputs,
}: {
  dimension: Dimension;
  raw: number;
  reference?: number;
  coverage: number;
  knownInputs: number;
  totalInputs: number;
}) {
  const verdict = verdictFor(dimension, raw, reference, coverage);
  const style = VERDICT[verdict];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
      <p className="truncate text-sm font-medium capitalize text-cocoa-700" title={DIMENSION_BLURBS[dimension]}>
        {DIMENSION_LABELS[dimension]}
      </p>

      <div
        className={`col-span-2 row-start-2 sm:col-span-1 sm:row-auto relative h-2.5 overflow-hidden rounded-full ${style.track}`}
        role="img"
        aria-label={
          reference === undefined
            ? `${DIMENSION_LABELS[dimension]}: ${pct(raw)} of 100, no price benchmark`
            : verdict === "limited"
              ? `${DIMENSION_LABELS[dimension]}: ${pct(raw)} of 100; limited evidence, so no comparison is made`
            : `${DIMENSION_LABELS[dimension]}: ${pct(raw)} of 100; expected ${pct(reference)} at this price — ${style.label}`
        }
      >
        <div className={`h-full rounded-full ${style.fill}`} style={{ width: `${Math.max(pct(raw), 1.5)}%` }} />
        {reference !== undefined && verdict !== "limited" && (
          // Par marker. Sits above the fill so it stays visible when the fill
          // runs past it.
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-cocoa-900/70"
            style={{ left: `${pct(reference)}%` }}
          />
        )}
      </div>

      <div className="col-start-2 row-start-1 flex items-baseline justify-end gap-2 sm:col-start-3">
        <span className="text-sm font-semibold tabular-nums text-cocoa-800">{pct(raw)}</span>
        {/* The par tick carries this on the bar; in words too, because "75 ·
            Below expected" beside "35 · As expected" read as a contradiction
            until the reader found the tick. */}
        {reference !== undefined && verdict !== "limited" && (
          <span className="text-xs tabular-nums text-cocoa-400">expected {pct(reference)}</span>
        )}
        <span className={`w-24 text-right text-xs font-medium ${style.text}`}>{style.label}</span>
      </div>
      {coverage < 1 && (
        <p className="col-span-2 sm:col-span-3 mt-1 text-xs text-cocoa-400">
          Based on {knownInputs} of {totalInputs} recorded inputs; missing inputs are excluded.
        </p>
      )}
    </div>
  );
}

function UnratedRow({ dimension, watch }: { dimension: Dimension; watch: Watch }) {
  const note = movementNote(watch);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
      <p className="truncate text-sm font-medium capitalize text-cocoa-400" title={DIMENSION_BLURBS[dimension]}>
        {DIMENSION_LABELS[dimension]}
      </p>
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-auto h-2.5 rounded-full bg-[repeating-linear-gradient(45deg,#F3EAE5_0_6px,#E6DAD5_6px_12px)]" />
      <span className="col-start-2 row-start-1 sm:col-start-3 w-24 text-right text-xs font-medium text-cocoa-400">Unrated</span>
      <p className="col-span-2 sm:col-span-3 text-xs text-cocoa-400">{unratedReason(watch, dimension)}</p>
      {/* Unrated is not the same as nothing to say. A meca-quartz chronograph is
          off the mechanical scale on purpose, and the reason to own one is the
          chronograph feel this line describes. It stays text, like frictions. */}
      {dimension === "movement" && note && (
        <p className="col-span-2 sm:col-span-3 text-xs text-cocoa-500">
          <span className="mr-1.5 rounded bg-cocoa-100 px-1.5 py-0.5 font-medium text-cocoa-600">{note.label}</span>
          {note.detail}
        </p>
      )}
    </div>
  );
}

function ScoreTile({ label, value, caption }: { label: string; value?: number; caption: string }) {
  return (
    <div className="rounded-lg border border-cocoa-200 bg-cocoa-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-cocoa-900">{value === undefined ? "—" : pct(value)}</p>
      <p className="mt-0.5 text-xs text-cocoa-500">{caption}</p>
    </div>
  );
}

export default function StandingPanel({ watch, standing }: { watch: Watch; standing: Standing }) {
  const rated = DIMENSIONS.filter((dimension) => standing.dimensions[dimension]);
  const ratedCount = rated.length;
  // An unpriced watch has no band and so no rubric to compare against.
  const banded = rated.some((dimension) => standing.dimensions[dimension]!.reference !== undefined);

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cocoa-500">Specification standing</h2>
          <p className="mt-1 text-sm text-cocoa-500">Rubric comparison with what this exact price should buy for {standing.peerLabel}.</p>
        </div>
        <p className="text-xs text-cocoa-400 sm:text-right">
          Rated on {ratedCount} of {DIMENSIONS.length} dimensions
          {standing.peerCount > 1 && <> · {standing.peerCount} similar watches</>}
        </p>
      </div>

      {ratedCount === 0 ? (
        <p className="rounded-lg bg-cocoa-50 px-3 py-6 text-center text-sm text-cocoa-500">
          Nothing recorded for this watch can be scored yet.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:max-w-2xl">
            <ScoreTile
              label="Quality"
              value={standing.qualityScore}
              caption={`Across ${ratedCount} rated dimension${ratedCount === 1 ? "" : "s"}`}
            />
            <ScoreTile
              label="Rubric value"
              value={standing.valueScore}
              caption={
                standing.valueScore === undefined
                  ? standing.peerLabel.startsWith("category unrated")
                    ? "Needs a category"
                    : "Needs a price"
                  : "Value vs continuous price expectation"
              }
            />
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <EvidenceCoverage watch={watch} standing={standing} />
            </div>
          </div>

          {standing.confidence === "low" && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Limited evidence: only {pct(standing.evidenceCoverage)}% of applicable scoring evidence is recorded. Treat
              the composite as provisional.
            </p>
          )}

          <div className="divide-y divide-cocoa-100">
            {rated.map((dimension) => (
              <DimensionMeter
                key={dimension}
                dimension={dimension}
                raw={standing.dimensions[dimension]!.raw}
                reference={standing.dimensions[dimension]!.reference}
                coverage={standing.dimensions[dimension]!.coverage}
                knownInputs={standing.dimensions[dimension]!.knownInputs}
                totalInputs={standing.dimensions[dimension]!.totalInputs}
              />
            ))}
            {standing.unrated.map((dimension) => (
              <UnratedRow key={dimension} dimension={dimension} watch={watch} />
            ))}
          </div>

          {banded ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-cocoa-400">
              <span className="inline-block h-3 w-0.5 bg-cocoa-900/70" />
              Continuous expectation at this price · peer label {standing.peerLabel}
            </p>
          ) : (
            <p className="mt-3 text-xs text-cocoa-400">
              No price recorded, so there is no band to score against — the numbers above are raw scores only.
            </p>
          )}

          {standing.qualityPercentile !== undefined && (
            <p className="mt-2 text-xs text-cocoa-500">
              Ranks above {pct(standing.qualityPercentile)}% of {standing.peerCount} similar watches in this price range.
            </p>
          )}

          {standing.frictions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {standing.frictions.map((friction) => (
                <span key={friction} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  {friction}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
