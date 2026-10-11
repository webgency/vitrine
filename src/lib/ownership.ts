import { MIN_INDEPENDENT_SOURCES } from "./valuation";

export type OwnershipKey = "purchase" | "trade-up" | "sell";

export interface OwnershipItem {
  key: OwnershipKey;
  label: string;
  /** Has something to show, so the full panel renders open. */
  open: boolean;
  /** One line naming what is missing; shown on the collapsed row. */
  missing?: string;
}

/**
 * The ownership panels of an owned watch, and which of them have anything to
 * say yet. A panel with no input collapses to one line naming the missing
 * input, rather than a card of "Not recorded" rows. Collapsing only hides: the
 * panel and its inline form are one click away, and nothing is estimated in
 * its place.
 */
export function ownershipItems(input: {
  purchaseRecorded?: boolean;
  exitSources?: number;
  listingState?: "none" | "draft" | "live" | "reserved";
}): OwnershipItem[] {
  const items: OwnershipItem[] = [];
  if (input.purchaseRecorded !== undefined) {
    items.push({
      key: "purchase",
      label: "What you paid",
      open: input.purchaseRecorded,
      missing: input.purchaseRecorded ? undefined : "Not recorded · private to this computer",
    });
  }
  if (input.exitSources !== undefined) {
    const needed = Math.max(0, MIN_INDEPENDENT_SOURCES - input.exitSources);
    items.push({
      key: "trade-up",
      label: "Trade-up",
      open: needed === 0,
      missing: needed === 0
        ? undefined
        : `Add ${needed} pre-owned listing${needed === 1 ? "" : "s"} to estimate your exit range`,
    });
  }
  if (input.listingState !== undefined) {
    items.push({
      key: "sell",
      label: "Sell or keep",
      open: input.listingState !== "none",
      missing: input.listingState === "none" ? "Not listed" : undefined,
    });
  }
  return items;
}
