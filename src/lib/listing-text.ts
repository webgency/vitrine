import { CONDITION_GRADES } from "./listing-shape.mjs";
import { SPEC_FIELDS } from "./specs";
import { formatNativeMoney } from "./format";
import type { ListingContent, Watch } from "./types";

export function gradeInfo(grade: string) {
  return CONDITION_GRADES.find((entry) => entry.id === grade);
}

/**
 * A first draft of the listing text, from what the record already holds: the
 * spec fields, the grade and what's included. Plain templating, no model.
 *
 * Like the scraper, it never invents: a spec the watch doesn't record is left
 * out rather than guessed, and nothing is said about condition beyond the
 * chosen grade and your own notes. You edit the result before publishing.
 */
export function draftListingText(
  watch: Pick<Watch, "brand" | "model" | "referenceNumber" | "specs">,
  content: Pick<ListingContent, "grade" | "conditionNotes" | "included" | "serviceHistory" | "askingPrice">,
): string {
  const title = [watch.brand, watch.model, watch.referenceNumber && `(ref. ${watch.referenceNumber})`].filter(Boolean).join(" ");
  const grade = gradeInfo(content.grade);
  const lines = [`For sale: ${title}.`, ""];

  if (grade) lines.push(`Condition: ${grade.label}. ${grade.definition}${content.conditionNotes ? ` ${content.conditionNotes}` : ""}`);
  lines.push(content.included.length ? `Included: ${content.included.join(", ")}.` : "Included: the watch only.");
  if (content.serviceHistory) lines.push(`Service: ${content.serviceHistory}`);

  const specs = SPEC_FIELDS.flatMap((field) => {
    const value = watch.specs[field.key];
    if (value === undefined || value === null || value === "") return [];
    return [`- ${field.label}: ${value}${field.unit ? ` ${field.unit}` : ""}`];
  });
  if (specs.length) lines.push("", "Specifications:", ...specs);

  lines.push("", `Asking ${formatNativeMoney(content.askingPrice)}.`);
  return lines.join("\n");
}
