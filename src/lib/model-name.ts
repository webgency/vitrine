/**
 * Proposes a cleaner model name from a scraped product title. Retailer titles
 * carry the brand, the reference, the case size and the word "Watch" for
 * search engines ("GMT-Master II watch - m126710blnr-0002"), and those leaked
 * into the collection's names. Each rule removes only text the watch already
 * records elsewhere — the brand field, the reference, the diameter — or a
 * "Watch" that follows a category word, so nothing descriptive is guessed away.
 *
 * Autofill only: the form proposes the result and keeps the scraped original a
 * click away. Save never rewrites a name.
 */

const SEPARATOR = String.raw`\s*[-–—|]\s*`;
const CATEGORY_WORDS = String.raw`(?:chronograph|diver|dive|gmt|automatic|dress|pilot|field)`;

const alnum = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Baltic Watches" and "Marloe Watch Company" are written "Baltic" and "Marloe" in titles too. */
function brandCore(brand: string): string {
  return brand.trim().replace(/\s+watch(?:es| company| co\.?)?$/i, "").trim();
}

export function cleanModelName(
  model: string,
  context: { brand?: string; referenceNumber?: string; caseDiameterMm?: number } = {}
): string {
  const original = model.trim().replace(/\s+/g, " ");
  let name = original;
  const core = context.brand ? brandCore(context.brand) : "";
  const ref = context.referenceNumber ? alnum(context.referenceNumber) : "";

  if (core) {
    // "Hermétique Tourer Bronze Green- Baltic Watches"
    name = name.replace(new RegExp(`${SEPARATOR}${escape(core)}(?:\\s+watch(?:es)?)?$`, "iu"), "");
    // "TISSOT GENTLEMAN 38MM"
    name = name.replace(new RegExp(`^${escape(core)}(?:\\s+watch(?:es)?)?\\s+`, "iu"), "");
  }

  if (ref.length >= 4) {
    // A separated last token that contains the reference: "- 4521546", "- m126710blnr-0002".
    const tail = name.match(new RegExp(`${SEPARATOR}(\\S+)$`, "u"));
    if (tail && alnum(tail[1]).includes(ref)) name = name.slice(0, tail.index);
    // The reference as a word, with a "Watch" right before it:
    // "Automatic Diver Watch PY057B Spiral Sunray Blue".
    name = name.replace(new RegExp(`(?:\\s+watch)?\\s+${escape(context.referenceNumber!.trim())}(?=\\s|$)`, "iu"), "");
  }

  if (context.caseDiameterMm !== undefined) {
    // A trailing size that repeats the recorded diameter: "- 40mm", "HELIOS 39mm", "38MM".
    const size = String(context.caseDiameterMm).replace(".", "[.,]");
    name = name.replace(new RegExp(`(?:${SEPARATOR}|\\s+)${size}\\s?mm$`, "iu"), "");
  }

  // "Espresso Chronograph Watch", "GMT-Master II watch". Not "The Red Watch":
  // only a category word or a model numeral before it makes "Watch" filler.
  name = name.replace(new RegExp(`(\\b${CATEGORY_WORDS}|\\b[IVX]+|\\d)\\s+watch$`, "iu"), "$1");

  name = name.replace(new RegExp(`${SEPARATOR}$`, "u"), "").replace(/\s+/g, " ").trim();
  // Never propose an empty name, or one that is only the reference.
  return name && alnum(name) !== ref ? name : original;
}
