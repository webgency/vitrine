import { unstable_noStore as noStore } from "next/cache";
import { getWatches } from "@/lib/store";
import { standingSummaries } from "@/lib/scoring";
import { IS_STATIC } from "@/lib/config";
import CollectionView from "@/components/CollectionView";
import CollectionSummaryBar from "@/components/CollectionSummaryBar";
import { collectionSummary } from "@/lib/collection-summary";

// The README section explaining that edits happen locally and publish on push.
const EDITING_DOCS_URL =
  "https://github.com/webgency/vitrine#deploying-to-github-pages-auto-published-read-only";

export default async function HomePage() {
  // Stay dynamic locally so edits show immediately; allow static prerender for
  // the GitHub Pages export.
  if (!IS_STATIC) noStore();
  const watches = await getWatches();
  // Standings are objective, so every watch gets one — owned pieces included —
  // and the whole collection acts as the peer pool.
  const summaries = standingSummaries(watches, watches);
  return (
    <div className="space-y-6">
      {/* Side by side only once the toolbar below also fits one row. Below that the
          stats get the full width and stay on a single line instead of wrapping
          into a two-line block beside the heading. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your collection</h1>
          <p className="text-sm text-cocoa-500">Track your wishlist, compare specs and prices, and grow your collection.</p>
          {/* A note, not a warning: nothing is wrong, this copy just can't write.
              The link answers the obvious next question. */}
          {IS_STATIC && (
            <p className="mt-3 w-fit rounded-lg bg-cocoa-100 px-3 py-1.5 text-sm text-cocoa-700">
              You&apos;re viewing the published copy, so it&apos;s read-only.{" "}
              <a href={EDITING_DOCS_URL} className="font-medium text-azalea-700 underline-offset-4 hover:underline">
                How editing works
              </a>
            </p>
          )}
        </div>
        {watches.length > 0 && <CollectionSummaryBar summary={collectionSummary(watches)} />}
      </div>
      <CollectionView watches={watches} scoreSummaries={summaries} />
    </div>
  );
}
