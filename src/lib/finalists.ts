import type { Watch } from "./types";

/**
 * At most five finalists. The shortlist grew to 46 of 79 wishlist watches and
 * stopped narrowing anything; a hard cap is what keeps "finalist" meaning the
 * few you are actually choosing between. Brief 12, decided 2026-10-11.
 */
export const MAX_FINALISTS = 5;

/** A finalist is a wishlist watch you haven't passed on. Personal, never scored. */
export function canBeFinalist(watch: Pick<Watch, "status" | "wishlistTier">): boolean {
  return watch.status === "wishlist" && watch.wishlistTier !== "pass";
}

export function finalists(watches: Watch[]): Watch[] {
  return watches.filter((watch) => watch.finalist && canBeFinalist(watch));
}

/**
 * Why a watch can't be pinned, or undefined when it can. Checked by the store
 * under the write lock, so two tabs can't both pin a fifth.
 */
export function finalistBlocker(watch: Watch, watches: Watch[]): string | undefined {
  if (!canBeFinalist(watch)) {
    return watch.status !== "wishlist"
      ? "Only wishlist watches can be finalists."
      : "This watch is marked Pass. Change its priority to pin it.";
  }
  const others = finalists(watches).filter((other) => other.id !== watch.id);
  if (others.length >= MAX_FINALISTS) {
    return `You already have ${MAX_FINALISTS} finalists. Unpin one on Decide first.`;
  }
  return undefined;
}
