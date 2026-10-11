"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pin or unpin a finalist. The server enforces the cap, so a refused pin
 * explains itself here rather than the button pretending to know the count.
 */
export default function FinalistToggle({ watchId, watchName, finalist }: {
  watchId: string;
  watchName: string;
  finalist: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/watches/${watchId}/finalist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalist: !finalist }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save. Please try again.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-pressed={finalist}
        aria-label={`${finalist ? "Unpin" : "Pin"} ${watchName} as a finalist`}
        disabled={saving}
        onClick={toggle}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium shadow-sm transition-colors ${
          finalist ? "bg-azalea text-cocoa-950" : "bg-white/95 text-cocoa-700 hover:bg-cocoa-50"
        }`}
      >
        <span aria-hidden>{finalist ? "★" : "☆"}</span>
        Finalist
      </button>
      {error && (
        <span role="alert" className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-cocoa-200 bg-white p-2 text-xs text-red-700 shadow-lg">
          {error}{" "}
          {error.includes("Decide") && (
            <Link href="/decide" className="font-medium text-azalea-700 underline-offset-4 hover:underline">Open Decide</Link>
          )}
        </span>
      )}
    </span>
  );
}
