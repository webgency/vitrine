import Link from "next/link";
import WatchForm from "@/components/WatchForm";
import { unstable_noStore as noStore } from "next/cache";
import { getWatches } from "@/lib/store";
import { trackedWatchKeys } from "@/lib/duplicates";

export default async function NewWatchPage() {
  // Read per request: a prerendered list would miss every watch added since
  // the build. The page is removed from the static export entirely.
  noStore();
  // Only what the duplicate warning needs, not the whole collection.
  const tracked = trackedWatchKeys(await getWatches());
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Add a watch</h1>
        <Link href="/" className="btn-secondary">
          ← Back
        </Link>
      </div>
      <WatchForm tracked={tracked} />
    </div>
  );
}
