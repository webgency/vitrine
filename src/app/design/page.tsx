import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { IS_STATIC } from "@/lib/config";
import { getWatches } from "@/lib/store";
import DesignRanker from "@/components/DesignRanker";

export default async function DesignPage() {
  if (!IS_STATIC) noStore();
  const watches = await getWatches();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Design appeal</h1>
        <p className="text-sm text-cocoa-500">
          Start with an anchored 1–5 reaction to each watch, then optionally refine ties with head-to-head choices.
          The resulting score sits beside rubric value on the Value page and never changes it.
        </p>
      </div>

      {IS_STATIC ? (
        <p className="card p-12 text-center text-sm text-cocoa-500">
          Rating designs needs the live app — this is the static export.
        </p>
      ) : (
        <DesignRanker watches={watches} />
      )}

      <p className="text-sm text-cocoa-500">
        <Link href="/value" className="font-medium text-azalea-700 hover:underline">
          See design beside value →
        </Link>
      </p>
    </div>
  );
}
