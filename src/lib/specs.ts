import { Dimension } from "./rubrics";
import { MOVEMENT_TYPES, QualityFlags, WatchSpecs } from "./types";

/** Detail-page chapter a spec or quality flag is listed under. */
export type SpecChapterId = "case" | "dial" | "movement" | "strap";

export const SPEC_CHAPTERS: { id: SpecChapterId; title: string }[] = [
  { id: "case", title: "Case" },
  { id: "dial", title: "Crystal & dial" },
  { id: "movement", title: "Movement" },
  { id: "strap", title: "Strap / bracelet" },
];

export interface SpecField {
  key: keyof WatchSpecs;
  label: string;
  unit?: string;
  type: "number" | "text" | "select";
  options?: readonly string[];
  /** For comparison highlighting: is a higher or lower value generally "better"? */
  prefer?: "higher" | "lower";
  chapter: SpecChapterId;
}

// Single source of truth for spec fields — drives the entry form, the detail
// view, and the comparison table. Add a field here and it shows up everywhere.
export const SPEC_FIELDS: SpecField[] = [
  { key: "caseDiameterMm", label: "Case diameter", unit: "mm", type: "number", chapter: "case" },
  { key: "caseThicknessMm", label: "Thickness", unit: "mm", type: "number", prefer: "lower", chapter: "case" },
  { key: "lugToLugMm", label: "Lug-to-lug", unit: "mm", type: "number", chapter: "case" },
  // A case dimension, but the reader looks for it when choosing a strap.
  { key: "lugWidthMm", label: "Lug width", unit: "mm", type: "number", chapter: "strap" },
  { key: "caseMaterial", label: "Case material", type: "text", chapter: "case" },
  { key: "movement", label: "Movement", type: "select", options: MOVEMENT_TYPES, chapter: "movement" },
  { key: "caliber", label: "Caliber", type: "text", chapter: "movement" },
  { key: "powerReserveHours", label: "Power reserve", unit: "h", type: "number", prefer: "higher", chapter: "movement" },
  { key: "waterResistanceM", label: "Water resistance", unit: "m", type: "number", prefer: "higher", chapter: "case" },
  { key: "crystal", label: "Crystal", type: "text", chapter: "dial" },
  { key: "dialColor", label: "Dial", type: "text", chapter: "dial" },
  { key: "braceletStrap", label: "Bracelet / strap", type: "text", chapter: "strap" },
  // Complications are movement functions, even when they show on the dial.
  { key: "complications", label: "Complications", type: "text", chapter: "movement" },
];

/** The detail page's key-spec strip, in display order. */
export const KEY_SPEC_KEYS: (keyof WatchSpecs)[] = [
  "caseDiameterMm",
  "lugToLugMm",
  "caseThicknessMm",
  "waterResistanceM",
  "caliber",
];

export interface QualityFlagField {
  key: keyof QualityFlags;
  label: string;
  unit?: string;
  /**
   * "boolean" fields are tri-state on purpose — see QUALITY_FLAG_UNSET. A
   * plain checkbox cannot express the difference the scoring engine cares
   * about most, between "not recorded" and "recorded as absent".
   */
  type: "number" | "boolean";
  /**
   * Which dimension the flag feeds, or undefined for flags that are recorded
   * but not scored. Grouping the form by this is the point of the section: a
   * dimension whose flags are all blank stays unrated, and the entry form is
   * where that becomes a visible choice rather than a silent omission.
   */
  dimension?: Dimension;
  hint?: string;
  chapter: SpecChapterId;
}

/** Sentinel for a tri-state flag left unrecorded. Never written to the store. */
export const QUALITY_FLAG_UNSET = "";

// Single source of truth for quality flags, same contract as SPEC_FIELDS.
// Ordered by the dimension each one feeds so the form can group them and show
// which dimensions a watch is on track to leave unrated.
export const QUALITY_FLAG_FIELDS: QualityFlagField[] = [
  {
    key: "regulatedPositions",
    label: "Regulated positions",
    type: "number",
    dimension: "movement",
    hint: "0 or blank = unregulated.",
    chapter: "movement",
  },
  {
    key: "hardenedCoatingHv",
    label: "Surface hardening",
    unit: "HV",
    type: "number",
    dimension: "caseCraft",
    chapter: "case",
  },
  { key: "sapphireBezelInsert", label: "Sapphire bezel insert", type: "boolean", dimension: "caseCraft", chapter: "case" },
  { key: "drilledLugs", label: "Drilled lugs", type: "boolean", dimension: "caseCraft", chapter: "case" },
  {
    key: "arLayers",
    label: "AR coating layers",
    type: "number",
    dimension: "caseCraft",
    hint: "Leave blank and use the toggle below if the brand only says it is coated.",
    // Scored as case craft, but the coating is on the crystal.
    chapter: "dial",
  },
  {
    key: "arCoated",
    label: "AR coated",
    type: "boolean",
    dimension: "caseCraft",
    hint: "For when no layer count is published. A recorded count takes precedence.",
    chapter: "dial",
  },
  {
    key: "braceletIncluded",
    label: "Bracelet included",
    type: "boolean",
    dimension: "bracelet",
    // "No" is not a bad bracelet, it means there is none to judge, and
    // scoreDimensions drops the dimension entirely rather than scoring 0.
    hint: 'Set "No" for a strap-only watch — the dimension goes unrated, not zero.',
    chapter: "strap",
  },
  { key: "microAdjustClasp", label: "Micro-adjust clasp", type: "boolean", dimension: "bracelet", chapter: "strap" },
  { key: "quickRelease", label: "Quick-release", type: "boolean", dimension: "bracelet", chapter: "strap" },
  {
    key: "antimagneticAm",
    label: "Antimagnetic",
    unit: "A/m",
    type: "number",
    dimension: "durability",
    // Magnetism is a movement problem, whatever part of the watch shields it.
    chapter: "movement",
  },
  {
    key: "accuracySpecSpd",
    label: "Accuracy spec",
    unit: "s/d",
    type: "number",
    dimension: "movement",
    hint: "The larger deviation either side: -4/+6 is 6. Credited as regulation.",
    chapter: "movement",
  },
];

/** Form value for a tri-state boolean flag. */
export const QUALITY_FLAG_YES = "yes";
export const QUALITY_FLAG_NO = "no";

/**
 * Stored flags -> form values. A flag that is absent becomes the unset
 * sentinel, and a stored false becomes "no" — the two must not converge, or
 * editing a watch would quietly upgrade "recorded as absent" to "unknown".
 */
export function qualityFlagsToForm(flags: QualityFlags | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of QUALITY_FLAG_FIELDS) {
    const stored = flags?.[field.key];
    values[field.key] =
      stored === undefined
        ? QUALITY_FLAG_UNSET
        : field.type === "boolean"
          ? stored
            ? QUALITY_FLAG_YES
            : QUALITY_FLAG_NO
          : String(stored);
  }
  return values;
}

/**
 * Form values -> stored flags, or undefined when nothing is recorded.
 *
 * Unset fields produce no key at all. Writing false for a field nobody
 * checked would be read by scoreDimensions as measured evidence and scored
 * against, turning a gap into a failure — the invariant that missing data is
 * never a zero. Returning undefined for an empty result lets the caller send
 * a clear rather than leave a stale object behind.
 */
export function qualityFlagsFromForm(values: Record<string, string>): QualityFlags | undefined {
  const flags: QualityFlags = {};
  for (const field of QUALITY_FLAG_FIELDS) {
    const raw = values[field.key]?.trim() ?? QUALITY_FLAG_UNSET;
    if (raw === QUALITY_FLAG_UNSET) continue;
    if (field.type === "boolean") {
      (flags[field.key] as boolean) = raw === QUALITY_FLAG_YES;
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) (flags[field.key] as number) = n;
    }
  }
  return Object.keys(flags).length ? flags : undefined;
}

export function formatSpecValue(field: SpecField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field.unit) return `${value} ${field.unit}`;
  return String(value);
}

function isRecorded(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

export interface SpecRow {
  key: string;
  label: string;
  value: string;
}

/** Key specs that are recorded, in strip order. Missing ones are left out, never dashed or filled. */
export function keySpecs(specs: WatchSpecs): SpecRow[] {
  return KEY_SPEC_KEYS.flatMap((key) => {
    const field = SPEC_FIELDS.find((f) => f.key === key)!;
    const value = specs[key];
    return isRecorded(value) ? [{ key, label: field.label, value: formatSpecValue(field, value) }] : [];
  });
}

export interface SpecChapterView {
  id: SpecChapterId;
  title: string;
  rows: SpecRow[];
  /** Labels of fields in this chapter with nothing recorded. */
  missing: string[];
}

/**
 * Specs and quality flags grouped for the detail page. Unrecorded fields are
 * named in `missing` instead of rendered as rows, so a gap stays visible as a
 * gap. A flag stored as false is a recorded absence and becomes a "No" row.
 */
export function specChapters(watch: { specs: WatchSpecs; qualityFlags?: QualityFlags }): SpecChapterView[] {
  return SPEC_CHAPTERS.map(({ id, title }) => {
    const rows: SpecRow[] = [];
    const missing: string[] = [];
    for (const field of SPEC_FIELDS.filter((f) => f.chapter === id)) {
      const value = watch.specs[field.key];
      if (isRecorded(value)) rows.push({ key: field.key, label: field.label, value: formatSpecValue(field, value) });
      else missing.push(field.label);
    }
    for (const field of QUALITY_FLAG_FIELDS.filter((f) => f.chapter === id)) {
      const value = watch.qualityFlags?.[field.key];
      if (!isRecorded(value)) {
        missing.push(field.label);
        continue;
      }
      const text =
        typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : `${Number(value).toLocaleString("en-US")}${field.unit ? ` ${field.unit}` : ""}`;
      rows.push({ key: field.key, label: field.label, value: text });
    }
    return { id, title, rows, missing };
  });
}
