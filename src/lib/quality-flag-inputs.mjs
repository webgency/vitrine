// Which qualityFlags each dimension reads, as plain key lists.
//
// scoring.ts holds the authoritative version as CASE_CRAFT_INPUTS and
// BRACELET_FLAGS, but those are predicates over a typed QualityFlags and
// scripts/audit-data.mjs runs under bare Node with no build step. This is the
// key-list form the audit needs; quality-flag-inputs.test.ts locks the two
// together by behaviour, so a flag added to one and not the other fails the
// suite rather than skewing a coverage number nobody re-derives.

/**
 * Keys that make caseCraft rated. Six keys, four inputs: arLayers and arCoated
 * are the same input recorded at two precisions, and sapphireBezelInsert and
 * ceramicBezelInsert are the one bezel input, so a record holding either of a
 * pair counts once toward coverage. See CASE_CRAFT_INPUTS in scoring.ts.
 */
export const CASE_CRAFT_FLAG_KEYS = [
  "hardenedCoatingHv",
  "sapphireBezelInsert",
  "ceramicBezelInsert",
  "drilledLugs",
  "arLayers",
  "arCoated",
];

/** Keys that make bracelet rated, when a bracelet is offered at all. */
export const BRACELET_FLAG_KEYS = ["braceletIncluded", "microAdjustClasp", "quickRelease"];
