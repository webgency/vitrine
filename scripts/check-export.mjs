#!/usr/bin/env node
// Fails the static build if seller-private data reached the export.
//
// The export ships page data to the browser, and the repo is public. Private
// data (data/private.json) is kept out by construction: build-static skips the
// file, prepare-pages deletes it, and the store returns nothing when IS_STATIC.
// This is the last check, run on the finished out/ directory, so a future
// change that routes a private field into a page fails here instead of
// publishing it. It looks for two things:
//   • private field names as serialized keys ("purchase": / \"purchase\":),
//     which no public page should contain;
//   • the text values stored in a local private.json (sources, notes, names),
//     when one exists. Amounts are skipped: numbers like 850 are everywhere.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Field names that only private.json uses. Keep in sync with PrivateWatchRecord. */
export const PRIVATE_KEYS = ["purchase", "minimumPrice", "saleClose", "serial"];

// Short strings ("USD", a two-letter source) would match public text by chance.
const MIN_VALUE_LENGTH = 5;
const SCANNED = new Set([".html", ".txt", ".js", ".json", ".rsc"]);

/** Text values worth searching for: every string in the private records
 * except currency codes and dates, which are public vocabulary. */
export function privateStrings(records) {
  const found = new Set();
  const visit = (value, key) => {
    if (typeof value === "string") {
      if (key === "currency" || key === "date" || /^\d{4}-\d{2}-\d{2}/.test(value)) return;
      if (value.trim().length >= MIN_VALUE_LENGTH) found.add(value.trim());
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  for (const record of Object.values(records ?? {})) visit(record);
  return [...found];
}

/** @param {{ path: string, text: string }[]} files */
export function findPrivateLeaks(files, records = {}) {
  const values = privateStrings(records);
  const leaks = [];
  for (const file of files) {
    for (const key of PRIVATE_KEYS) {
      if (file.text.includes(`"${key}":`) || file.text.includes(`\\"${key}\\":`)) {
        leaks.push(`${file.path}: contains the private field "${key}"`);
      }
    }
    for (const value of values) {
      if (file.text.includes(value) || file.text.includes(JSON.stringify(value).slice(1, -1))) {
        leaks.push(`${file.path}: contains a value from data/private.json`);
      }
    }
  }
  return leaks;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return files.flat();
}

async function readPrivateRecords(root) {
  try {
    return JSON.parse(await readFile(path.join(root, "data", "private.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function checkExport(outDir, root) {
  const records = await readPrivateRecords(root);
  const paths = (await listFiles(outDir)).filter((file) => SCANNED.has(path.extname(file)));
  const files = await Promise.all(paths.map(async (file) => ({ path: path.relative(root, file), text: await readFile(file, "utf8") })));
  // Never print the leaked value itself: this runs in CI logs, which are public.
  return findPrivateLeaks(files, records);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.cwd();
  const outDir = path.resolve(root, process.argv[2] ?? "out");
  const leaks = await checkExport(outDir, root);
  if (leaks.length) {
    console.error(`check-export: private data found in the static export:\n- ${[...new Set(leaks)].join("\n- ")}`);
    process.exit(1);
  }
  console.log("check-export: no private data in the export.");
}
