import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { IS_STATIC } from "@/lib/config";
import { getWatches } from "@/lib/store";
import { getSeller } from "@/lib/seller";
import ForSaleCard from "@/components/ForSaleCard";

export const metadata: Metadata = { title: "For sale" };

/** Public listings: live first, then reserved, newest listing first. Drafts
 * never appear — they aren't in watches.json at all. */
export default async function ForSalePage() {
  if (!IS_STATIC) noStore();
  const [watches, seller] = await Promise.all([getWatches(), getSeller()]);
  const listed = watches
    .filter((watch) => watch.status === "owned" && watch.listing)
    .sort((a, b) => (a.listing!.state === b.listing!.state ? b.listing!.listedAt.localeCompare(a.listing!.listedAt) : a.listing!.state === "live" ? -1 : 1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">For sale</h1>
        <p className="text-sm text-cocoa-500">Watches from this collection, photographed and described by their owner.</p>
      </div>
      {!seller && !IS_STATIC && listed.length > 0 && (
        <p className="rounded-md bg-cocoa-100 p-3 text-sm text-cocoa-700">
          Buyers can&apos;t contact you yet: add <code>data/seller.json</code> (see <code>data/seller.example.json</code>).
        </p>
      )}
      {listed.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {listed.map((watch) => (
            <div key={watch.id} id={watch.id} className="scroll-mt-6">
              <ForSaleCard title={`${watch.brand} ${watch.model}`} listing={watch.listing!} seller={seller} />
              <Link href={`/watch/${watch.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-azalea-700 hover:underline">Full specs</Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="card p-5 text-sm text-cocoa-600">Nothing is for sale right now.</p>
      )}
    </div>
  );
}
