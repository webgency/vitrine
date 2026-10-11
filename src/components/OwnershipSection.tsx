import type { ReactNode } from "react";
import type { OwnershipItem, OwnershipKey } from "@/lib/ownership";

/**
 * An owned watch's purchase, trade-up and sale panels under one heading. A
 * panel with input renders in full; one without collapses to a single row
 * naming what's missing, and opens into the same panel and inline form. Before
 * this, an owned watch with nothing recorded was four cards of "Not recorded".
 */
export default function OwnershipSection({
  items,
  panels,
}: {
  items: OwnershipItem[];
  panels: Partial<Record<OwnershipKey, ReactNode>>;
}) {
  const shown = items.filter((item) => panels[item.key]);
  if (shown.length === 0) return null;
  const collapsed = shown.filter((item) => !item.open);

  return (
    <section aria-labelledby="ownership-heading" className="space-y-4">
      <h2 id="ownership-heading" className="text-sm font-semibold uppercase tracking-wide text-cocoa-500">
        Ownership
      </h2>

      {collapsed.length > 0 && (
        <div className="card divide-y divide-cocoa-100">
          {collapsed.map((item) => (
            <details key={item.key} id={item.key} className="group scroll-mt-6">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-cocoa-800">{item.label}</span>
                  <span className="block text-xs text-cocoa-500 group-open:!hidden sm:ml-2 sm:inline">{item.missing}</span>
                </span>
                <span className="shrink-0 text-sm font-medium text-azalea-700">
                  <span className="group-open:hidden">Open</span>
                  <span className="hidden group-open:inline">Close</span>
                </span>
              </summary>
              {/* The row already names the panel and sits in a card, so the
                  panel's own heading goes to screen readers only and its card
                  chrome flattens, rather than a card titled twice inside a card. */}
              <div className="px-5 pb-5 [&_h2]:sr-only [&>.card]:border-0 [&>.card]:bg-transparent [&>.card]:p-0 [&>.card]:shadow-none">
                {panels[item.key]}
              </div>
            </details>
          ))}
        </div>
      )}

      {shown.filter((item) => item.open).map((item) => (
        <div key={item.key} id={item.key} className="scroll-mt-6">
          {panels[item.key]}
        </div>
      ))}
    </section>
  );
}
