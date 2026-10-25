#!/usr/bin/env node
// Backfill missing specs, tags, and quality flags in data/watches.json using
// the Claude API with web search. For each watch with gaps, Claude researches
// the model across the web (brand site, reviews, spec databases), then a
// second structured-output call turns the findings into typed fields.
//
// Conservative by design: only fills fields that are currently missing, never
// overwrites existing data, and drops physically implausible readings. Fields
// the research couldn't verify stay missing — no guessed values.
//
// Gaps are detected per field, quality flags included. A definitive negative
// (drilled lugs: no) is recorded as false and settles the field; only genuinely
// unverifiable fields stay missing, so those watches re-queue on later runs.
// Because most watches have only a few of the ten flags recorded, a full run
// covers nearly the whole collection — use --limit or --id to work in batches.
//
// friction (availability, upcharges) is deliberately NOT backfilled: web
// results go stale too fast, and brandLiquidity is a personal judgment call.
//
// Requires ANTHROPIC_API_KEY. Run from a terminal with real network access.
//
// Usage:
//   node scripts/backfill-specs.mjs              # research + write all watches with gaps
//   node scripts/backfill-specs.mjs --dry        # research + report, write nothing
//   node scripts/backfill-specs.mjs --limit=5    # only the first N watches with gaps
//   node scripts/backfill-specs.mjs --id=w01     # only this watch id (repeatable)
//   node scripts/backfill-specs.mjs --verbose    # show research summaries

import { readFile, writeFile } from "node:fs/promises";
import { inSpecRange, LUG_TO_LUG_MIN_RATIO } from "../src/lib/spec-ranges.mjs";
import { normalizeTags } from "../src/lib/category-tags.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const DATA_URL = new URL("../data/watches.json", import.meta.url);

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const VERBOSE = args.includes("--verbose");
const ONLY = args.filter((a) => a.startsWith("--id=")).map((a) => a.slice(5));
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.slice(8) ?? Infinity);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Export it and re-run.");
  process.exit(1);
}

const client = new Anthropic();
const MODEL = "claude-opus-5";

// Keep in sync with src/lib/extract.ts (scripts are plain JS and can't import
// the TypeScript module).
const NUMBER_SPECS = [
  ["caseDiameterMm", "case diameter in mm"],
  ["caseThicknessMm", "case thickness in mm"],
  ["lugToLugMm", "lug-to-lug in mm"],
  ["lugWidthMm", "lug width in mm"],
  ["powerReserveHours", "power reserve in hours"],
  ["waterResistanceM", "water resistance in meters"],
];
const TEXT_SPECS = [
  ["caseMaterial", "case material"],
  ["movement", "movement type (automatic/manual/quartz/spring-drive/solar/kinetic)"],
  ["caliber", "movement caliber name/number"],
  ["crystal", "crystal material"],
];
// Asked for individually. The first four feed the caseCraft score, which is
// left unrated when none of them is recorded.
const QUALITY_FLAGS = [
  ["hardenedCoatingHv", "surface hardening in Vickers (HV), e.g. a DLC or Cerakote figure"],
  ["sapphireBezelInsert", "whether the bezel insert is sapphire (true/false)"],
  ["ceramicBezelInsert", "whether the bezel insert is ceramic, e.g. Cerachrom (true/false)"],
  ["drilledLugs", "whether the lugs are drilled through (true/false)"],
  ["arLayers", "number of anti-reflective coating layers on the crystal"],
  ["regulatedPositions", "number of positions the movement is regulated in"],
  ["accuracySpecSpd", "manufacturer accuracy spec in seconds/day"],
  ["antimagneticAm", "antimagnetic rating in A/m"],
  ["microAdjustClasp", "whether the clasp has on-the-fly micro-adjustment (true/false)"],
  ["quickRelease", "whether the strap or bracelet is quick-release (true/false)"],
  ["braceletIncluded", "whether a metal bracelet is included in the box (true/false)"],
];

// Structured outputs reject schemas with more than 16 union-typed (nullable)
// parameters, so specs (10 nullables) and quality flags (10 nullables) are
// parsed in two separate calls and merged.
const SpecsSchema = z.object({
  specs: z.object({
    caseDiameterMm: z.number().nullable(),
    caseThicknessMm: z.number().nullable(),
    lugToLugMm: z.number().nullable(),
    lugWidthMm: z.number().nullable(),
    caseMaterial: z.string().nullable(),
    movement: z
      .enum(["automatic", "manual", "quartz", "spring-drive", "solar", "kinetic", "other"])
      .nullable(),
    caliber: z.string().nullable(),
    powerReserveHours: z.number().nullable(),
    waterResistanceM: z.number().nullable(),
    crystal: z.string().nullable(),
  }),
});

const TagsFlagsSchema = z.object({
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
  }),
});

// Same plausibility rules as sanitizeSpecs in src/lib/extract.ts, off the
// shared bounds in src/lib/spec-ranges.mjs.
function sanitizeSpecs(specs) {
  const s = { ...specs };
  for (const key of ["caseDiameterMm", "caseThicknessMm", "lugWidthMm", "waterResistanceM", "powerReserveHours"]) {
    if (s[key] !== undefined && !inSpecRange(key, s[key])) delete s[key];
  }
  if (s.caseThicknessMm !== undefined && s.caseDiameterMm !== undefined && s.caseThicknessMm >= s.caseDiameterMm) {
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

function missingFields(watch) {
  const specs = watch.specs ?? {};
  const missing = [];
  for (const [key, label] of [...NUMBER_SPECS, ...TEXT_SPECS]) {
    if (specs[key] === undefined || specs[key] === null || specs[key] === "") missing.push(label);
  }
  if (!(watch.tags ?? []).length) missing.push("category (diver/chronograph/GMT/worldtimer/dress)");
  // Per flag, not per object. Treating the whole set as done once any one flag
  // was recorded meant the first run filled one or two and every later run
  // skipped the watch entirely, which is why 19 watches still have none of the
  // four caseCraft inputs.
  const flags = watch.qualityFlags ?? {};
  for (const [key, label] of QUALITY_FLAGS) {
    if (flags[key] === undefined || flags[key] === null) missing.push(label);
  }
  return missing;
}

function describeWatch(watch) {
  const lines = [
    `Brand: ${watch.brand}`,
    `Model: ${watch.model}`,
  ];
  if (watch.referenceNumber) lines.push(`Reference: ${watch.referenceNumber}`);
  if (watch.price) lines.push(`Approx. price: ${watch.price.amount} ${watch.price.currency}`);
  const urls = (watch.links ?? []).map((l) => l.url).slice(0, 2);
  if (urls.length) lines.push(`Product page(s): ${urls.join(" , ")}`);
  const known = Object.entries(watch.specs ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  if (known) lines.push(`Already known (for identification only): ${known}`);
  return lines.join("\n");
}

async function research(watch, missing) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    system:
      "You research watch specifications. Use web search to find the manufacturer's " +
      "specs for the exact watch given (verify you have the right model and variant — " +
      "the reference number and price help disambiguate). Prefer the brand's own site, " +
      "then reputable reviews and spec databases. Report only what sources actually " +
      "state, with the source for each figure. For anything you cannot verify, say " +
      "'not found' explicitly — do not estimate.",
    messages: [
      {
        role: "user",
        content:
          `${describeWatch(watch)}\n\nFind and report these missing details:\n- ${missing.join("\n- ")}`,
      },
    ],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const STRUCTURE_SYSTEM =
  "Convert the research notes into structured fields. Only include values the notes " +
  "state with a source; anything marked 'not found', estimated, or ambiguous is null. " +
  "Water resistance in ATM/bar converts to meters (x10); power reserve in days to hours. " +
  "antimagneticAm is in A/m: convert gauss or oersted ratings by multiplying by 80 " +
  "(e.g. 15,000 gauss = 1,200,000 A/m); an unquantified 'antimagnetic' claim (ISO 764) " +
  "is 4800 A/m. accuracySpecSpd is the worst-case daily deviation in seconds as a " +
  "positive number (COSC -4/+6 = 6; METAS 0/+5 = 5). A quartz watch's battery life " +
  "is not a power reserve — leave powerReserveHours null.";

async function structure(researchText) {
  const [specsResponse, flagsResponse] = await Promise.all(
    [SpecsSchema, TagsFlagsSchema].map((schema) =>
      client.messages.parse({
        model: MODEL,
        max_tokens: 4096,
        system: STRUCTURE_SYSTEM,
        messages: [{ role: "user", content: researchText }],
        output_config: { format: zodOutputFormat(schema) },
      })
    )
  );
  if (!specsResponse.parsed_output || !flagsResponse.parsed_output) return null;
  return { ...specsResponse.parsed_output, ...flagsResponse.parsed_output };
}

// Fill only fields that are currently absent. Returns the list of fields set.
function merge(watch, result) {
  const filled = [];
  const specs = { ...(watch.specs ?? {}) };
  const candidate = sanitizeSpecs(
    Object.fromEntries(Object.entries(result.specs).filter(([, v]) => v !== null && v !== ""))
  );
  for (const [key, value] of Object.entries(candidate)) {
    if (specs[key] === undefined || specs[key] === null || specs[key] === "") {
      specs[key] = value;
      filled.push(`specs.${key}=${value}`);
    }
  }
  watch.specs = specs;

  if (!(watch.tags ?? []).length && result.tags.length) {
    // Writes watches.json directly, past the store, so it normalizes here too.
    watch.tags = normalizeTags(result.tags);
    filled.push(`tags=${watch.tags.join(",")}`);
  }

  const flags = { ...(watch.qualityFlags ?? {}) };
  for (const [key, value] of Object.entries(result.qualityFlags)) {
    if (value === null) continue;
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) continue;
    if (flags[key] === undefined) {
      flags[key] = value;
      filled.push(`qualityFlags.${key}=${value}`);
    }
  }
  if (Object.keys(flags).length) watch.qualityFlags = flags;

  return filled;
}

const watches = JSON.parse(await readFile(DATA_URL, "utf8"));

let queue = watches
  .map((watch) => ({ watch, missing: missingFields(watch) }))
  .filter(({ watch, missing }) => missing.length && (!ONLY.length || ONLY.includes(watch.id)));
queue = queue.slice(0, LIMIT);

console.log(`${queue.length} watch(es) with gaps${DRY ? " (dry run)" : ""}\n`);

let totalFilled = 0;
let failures = 0;

for (const { watch, missing } of queue) {
  const label = `${watch.id} ${watch.brand} ${watch.model}`;
  try {
    const notes = await research(watch, missing);
    if (VERBOSE) console.log(`--- research: ${label}\n${notes}\n---`);
    const result = await structure(notes);
    if (!result) {
      failures++;
      console.log(`✗ ${label}: no structured output`);
      continue;
    }
    const filled = merge(watch, result);
    totalFilled += filled.length;
    console.log(filled.length ? `✓ ${label}\n    ${filled.join("\n    ")}` : `- ${label}: nothing new verified`);
  } catch (error) {
    failures++;
    console.log(`✗ ${label}: ${error?.message ?? error}`);
  }
}

console.log(`\nFilled ${totalFilled} field(s) across ${queue.length} watch(es); ${failures} failure(s).`);

if (!DRY && totalFilled > 0) {
  await writeFile(DATA_URL, JSON.stringify(watches, null, 2) + "\n");
  console.log(`Wrote ${DATA_URL.pathname}`);
  console.log("Run `npm run validate:data` to confirm the file is still valid.");
} else if (DRY) {
  console.log("Dry run — nothing written.");
}
