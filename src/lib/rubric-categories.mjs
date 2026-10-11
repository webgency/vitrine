// The categories a watch can be scored in. Value no longer depends on the
// category (it is compared across them), but the peer label still does.
//
// Plain .mjs so scripts/audit-data.mjs can read it under bare Node. rubrics.ts
// is the authority and imports this rather than restating the list, so a
// category added there cannot be missed here.
export const RUBRIC_CATEGORIES = ["diver", "chronograph", "gmt", "dress", "sports"];
