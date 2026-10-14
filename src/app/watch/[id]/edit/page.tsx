import Link from "next/link";
import { notFound } from "next/navigation";
import { getWatch } from "@/lib/store";
import { getPrivateRecord } from "@/lib/private-store";
import WatchForm from "@/components/WatchForm";

export const dynamic = "force-dynamic";

export default async function EditWatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [watch, privateRecord] = await Promise.all([getWatch(id), getPrivateRecord(id)]);
  if (!watch) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Edit <span className="text-cocoa-400">·</span> {watch.brand} {watch.model}
        </h1>
        <Link href={`/watch/${watch.id}`} className="btn-secondary">
          ← Back
        </Link>
      </div>
      <WatchForm initial={watch} purchase={privateRecord?.purchase} />
    </div>
  );
}
