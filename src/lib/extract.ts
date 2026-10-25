// Claude-powered spec extraction from product-page text. Used by scrape.ts as
// the primary extractor, with the regex path as fallback when no API key is
// configured or the call fails.
//
// Design constraints (mirrors the scoring engine's rules):
// - Anything the page doesn't explicitly state comes back null and is dropped —
//   the model is instructed never to guess, and sanity checks reject readings
//   that are physically implausible (the regex path's known failure mode).
// - Friction is extracted without brandLiquidity (a user judgment call), so it
//   is exposed as a Partial<Friction>.
//
// Runs server-side only. Requires ANTHROPIC_API_KEY; returns null without it.

import Anthropic from "@anthropic-ai/sdk";
import { normalizeTags } from "./categories";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { Friction, MOVEMENT_TYPES, QualityFlags, WatchSpecs } from "./types";
import { inSpecRange, LUG_TO_LUG_MIN_RATIO } from "./spec-ranges.mjs";

export const EXTRACTION_MODEL = "claude-opus-5";

// How much page text we hand to the model (~15K tokens worst case).
const MAX_INPUT_CHARS = 60_000;

const ExtractionSchema = z.object({
  brand: z.string().nullable(),
  model: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  specs: z.object({
    caseDiameterMm: z.number().nullable(),
    caseThicknessMm: z.number().nullable(),
    lugToLugMm: z.number().nullable(),
    lugWidthMm: z.number().nullable(),
    caseMaterial: z.string().nullable(),
    movement: z.enum(MOVEMENT_TYPES as [string, ...string[]]).nullable(),
    caliber: z.string().nullable(),
    powerReserveHours: z.number().nullable(),
    waterResistanceM: z.number().nullable(),
    crystal: z.string().nullable(),
    dialColor: z.string().nullable(),
    braceletStrap: z.string().nullable(),
    complications: z.string().nullable(),
  }),
  tags: z.array(z.enum(["diver", "chronograph", "GMT", "dress", "worldtimer"])),
  qualityFlags: z.object({
    regulatedPositions: z.number().nullable(),
    accuracySpecSpd: z.number().nullable(),
    hardenedCoatingHv: z.number().nullable(),
    antimagneticAm: z.number().nullable(),
    sapphireBezelInsert: z.boolean().nullable(),
    ceramicBezelInsert: z.boolean().nullable(),
    drilledLugs: z.boolean().nullable(),
    microAdjustClasp: z.boolean().nullable(),
    quickRelease: z.boolean().nullable(),
    braceletIncluded: z.boolean().nullable(),
    arLayers: z.number().nullable(),
    arCoated: z.boolean().nullable(),
  }),
  friction: z.object({
    availability: z.enum(["in-stock", "pre-order", "sold-out", "discontinued"]).nullable(),
    expectedShipDate: z.string().nullable(),
    braceletUpchargeUsd: z.number().nullable(),
  }),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractedDetails {
  brand?: string;
  model?: string;
  referenceNumber?: string;
  specs: WatchSpecs;
  tags: string[];
  qualityFlags?: QualityFlags;
  friction?: Partial<Friction>;
}

const EXTRACTION_SYSTEM = `You extract watch specifications from product-page text.

Rules:
- Only report what the text explicitly states. Return null for anything not stated — never guess, infer typical values, or fill in from general knowledge of the brand or model.
- Convert units: water resistance given in ATM or bar becomes meters (1 ATM/bar = 10m); power reserve given in days becomes hours; antimagneticAm is in A/m, so a rating in gauss or oersted is multiplied by 80 (15,000 gauss = 1,200,000 A/m) and an unquantified "antimagnetic" claim (ISO 764) is 4800 A/m.
- accuracySpecSpd is the worst-case daily deviation in seconds as a positive number (COSC -4/+6 = 6; METAS 0/+5 = 5). A quartz watch's battery life is not a power reserve — leave powerReserveHours null.
- caliber is the movement's name/number as stated (e.g. "Sellita SW200-1", "Miyota 9015"), without surrounding marketing prose.
- tags: include a category only when the page clearly identifies the watch as that type (a rotating dive bezel + 200m WR marks a diver; chronograph pushers/subdials a chronograph; a 24h/second-timezone hand a GMT; "worldtimer" only for true worldtimer complications). A plain time-only watch with no sport features is "dress".
- qualityFlags booleans: true only when explicitly stated; null when unmentioned. braceletIncluded means a metal bracelet ships with the watch at the listed price.
- friction.availability: "pre-order" only when the page says so; "in-stock" when it clearly offers immediate purchase; null when unclear. braceletUpchargeUsd is the extra cost to choose a bracelet over the stock strap, in USD, only if shown in USD.
- Ignore specs that belong to other products (related items, cross-sells) — only the primary product on the page.`;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  cachedClient ??= new Anthropic();
  return cachedClient;
}

/**
 * Drop physically implausible readings instead of storing them — a wrong
 * thickness scores worse than a missing one. Exported for tests and reused by
 * the backfill script's merge step. The bounds live in ./spec-ranges.mjs so
 * that scripts/validate-data.mjs enforces exactly the same numbers against
 * what is already on disk.
 */
export function sanitizeSpecs(specs: WatchSpecs): WatchSpecs {
  const s = { ...specs };
  for (const key of ["caseDiameterMm", "caseThicknessMm", "lugWidthMm", "waterResistanceM", "powerReserveHours"] as const) {
    if (s[key] !== undefined && !inSpecRange(key, s[key])) delete s[key];
  }
  if (
    s.caseThicknessMm !== undefined &&
    s.caseDiameterMm !== undefined &&
    s.caseThicknessMm >= s.caseDiameterMm
  ) {
    // A "case" as thick as it is wide is a misread, and we can't tell which
    // number is wrong.
    delete s.caseThicknessMm;
    delete s.caseDiameterMm;
  }
  if (s.lugToLugMm !== undefined) {
    const tooSmall =
      s.caseDiameterMm !== undefined && s.lugToLugMm < s.caseDiameterMm * LUG_TO_LUG_MIN_RATIO;
    if (!inSpecRange("lugToLugMm", s.lugToLugMm) || tooSmall) delete s.lugToLugMm;
  }
  return s;
}

function cleanString(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Map the schema output (nulls, always-present objects) onto our sparse domain shapes. */
export function toExtractedDetails(raw: Extraction): ExtractedDetails {
  const specs: WatchSpecs = {};
  for (const [key, value] of Object.entries(raw.specs)) {
    if (value === null) continue;
    if (typeof value === "string") {
      const cleaned = cleanString(value);
      if (cleaned) (specs as Record<string, unknown>)[key] = cleaned;
    } else {
      (specs as Record<string, unknown>)[key] = value;
    }
  }

  const qualityFlags: QualityFlags = {};
  for (const [key, value] of Object.entries(raw.qualityFlags)) {
    if (value === null) continue;
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) continue;
    (qualityFlags as Record<string, unknown>)[key] = value;
  }

  const friction: Partial<Friction> = {};
  if (raw.friction.availability) friction.availability = raw.friction.availability;
  const shipDate = cleanString(raw.friction.expectedShipDate);
  if (shipDate) friction.expectedShipDate = shipDate;
  if (raw.friction.braceletUpchargeUsd !== null && raw.friction.braceletUpchargeUsd > 0) {
    friction.braceletUpchargeUsd = raw.friction.braceletUpchargeUsd;
  }

  const out: ExtractedDetails = {
    specs: sanitizeSpecs(specs),
    // The schema enum says "GMT" for the model's benefit; stored tags are lowercase.
    tags: normalizeTags(raw.tags),
  };
  const brand = cleanString(raw.brand);
  const model = cleanString(raw.model);
  const referenceNumber = cleanString(raw.referenceNumber);
  if (brand) out.brand = brand;
  if (model) out.model = model;
  if (referenceNumber) out.referenceNumber = referenceNumber;
  if (Object.keys(qualityFlags).length) out.qualityFlags = qualityFlags;
  if (friction.availability) out.friction = friction;
  return out;
}

/**
 * Extract watch details from page text via the Claude API. Returns null when
 * no API key is configured or the call fails, so the caller can fall back to
 * the regex extractor.
 */
export async function extractWatchDetails(pageText: string): Promise<ExtractedDetails | null> {
  const client = getClient();
  if (!client || !pageText.trim()) return null;

  try {
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Product page text:\n\n${pageText.slice(0, MAX_INPUT_CHARS)}`,
        },
      ],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });
    if (!response.parsed_output) return null;
    return toExtractedDetails(response.parsed_output);
  } catch (error) {
    console.warn("Claude extraction failed; falling back to regex:", error);
    return null;
  }
}
