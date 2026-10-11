// Typed surface for the category vocabulary.
//
// The tag table lives in ./categories.mjs so scripts/audit-data.mjs can import
// it under bare Node. This file adds the types and the one thing that needs
// TypeScript: the water-resistance expectation for the fifth category.

import {
  CATEGORIES as CATEGORY_LIST,
  TAG_TO_CATEGORY as TAG_MAP,
  CATEGORY_WR_EXPECTATION as WR_EXPECTATION,
  categoriesInTags as categoriesInTagsJs,
  categoryFor as categoryForJs,
  normalizeTags as normalizeTagsJs,
  resolveCategory as resolveCategoryJs,
} from "./category-tags.mjs";

import { CATEGORY_EXPECTATION as RUBRIC_EXPECTATION } from "./rubrics";
import type { ScoringCategory, Watch } from "./types";

/**
 * The five categories the collection is scored against.
 *
 * Identical to ScoringCategory. The alias is kept because this module is the
 * one that resolves a category from tags, and callers read `Category` as "what
 * a tag resolved to" rather than "what was written in the record".
 */
export type Category = ScoringCategory;

export const CATEGORIES: readonly Category[] = CATEGORY_LIST as Category[];

/** Descriptive tags mapped to the category they imply. Keys are lowercase. */
export const TAG_TO_CATEGORY: Readonly<Record<string, Category>> = TAG_MAP as Record<string, Category>;

export interface CategoryExpectation {
  wrM: number;
  needsBezel: boolean;
  needsScrewCrown: boolean;
}

/**
 * Fitness-for-purpose expectations for all five categories, re-exported from
 * rubrics.ts rather than restated so there is one set of numbers.
 */
export const CATEGORY_EXPECTATION: Readonly<Record<Category, CategoryExpectation>> = RUBRIC_EXPECTATION;

/** Water resistance each category is judged against, for bare-Node consumers. */
export const CATEGORY_WR_EXPECTATION: Readonly<Record<Category, number>> =
  WR_EXPECTATION as Record<Category, number>;

/**
 * Category implied by a tag list, or undefined when none resolve.
 * There is no default: unknown is unrated, never `dress`.
 */
export function resolveCategory(tags: string[] = []): Category | undefined {
  return resolveCategoryJs(tags);
}

/** Explicit `scoringCategory` when set, else the tags. Undefined means unrated. */
export function categoryFor(watch: Pick<Watch, "scoringCategory" | "tags">): Category | undefined {
  return categoryForJs(watch);
}

/** Tags lowercased, trimmed and de-duplicated, order preserved. */
export function normalizeTags(tags: string[] = []): string[] {
  return normalizeTagsJs(tags);
}

/** Tags that read wrong in lowercase. Everything else displays as stored. */
const TAG_LABELS: Readonly<Record<string, string>> = { gmt: "GMT" };

/** How a stored (lowercase) tag is shown. */
export function tagLabel(tag: string): string {
  return TAG_LABELS[tag.toLowerCase().trim()] ?? tag;
}

/** Every distinct category the tags resolve to. More than one means a hybrid. */
export function categoriesInTags(tags: string[] = []): Category[] {
  return categoriesInTagsJs(tags);
}
