// How a long refresh run writes back without losing edits made meanwhile.
//
// Plain .mjs so scripts/enrich-watches.mjs (bare Node) can import it.
//
// The refresh reads watches.json, spends minutes fetching retailer pages, then
// writes the file. Once it ran on a schedule, an edit saved in the app during
// that window (from the phone, say) would be overwritten by the copy the run
// read at the start. So the write starts from the file as it is now and takes
// a refreshed watch only where nobody touched it since the run read it.

/**
 * @template {{ id: string }} W
 * @param {W[]} current The file as it is at write time.
 * @param {Map<string, W>} before Each watch as this run first read it.
 * @param {W[]} refreshed This run's results.
 * @returns {{ watches: W[], skipped: string[] }} `skipped` lists watches the run
 *   changed but someone else edited first; their edit is kept and the refresh
 *   for them is dropped, to be picked up next run.
 */
export function mergeRefreshed(current, before, refreshed) {
  const mine = new Map(refreshed.map((watch) => [watch.id, watch]));
  const skipped = [];
  // The current file decides order and membership, so a watch added or deleted
  // in the app during the run stays added or deleted.
  const watches = current.map((watch) => {
    const original = before.get(watch.id);
    const ours = mine.get(watch.id);
    if (!original || !ours) return watch;
    if (same(watch, original)) return ours;
    if (!same(ours, original)) skipped.push(watch.id);
    return watch;
  });
  return { watches, skipped };
}

// Both sides come from the same JSON serialization, so key order matches
// unless the watch was rewritten, which counts as touched. That errs toward
// keeping the edit.
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
