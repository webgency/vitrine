// Prepares a static, read-only subset of the app for the GitHub Pages export.
//
// GitHub Pages can't run a server, so the routes that need one — the JSON API
// and the add/edit forms that POST to it — are removed before `next build`
// with output: 'export'. This runs only in CI on a throwaway checkout; your
// committed source keeps the full editable app for local use.
import { readFile, rm, writeFile } from "node:fs/promises";

// Route config must be a literal for Next's build analysis. Dynamic mode reads
// the current JSON on every request; the export instead pre-renders every id.
const detailPage = "src/app/watch/[id]/page.tsx";
const detailSource = await readFile(detailPage, "utf8");
const dynamicConfig = 'export const dynamic = "force-dynamic";';
if (!detailSource.includes(dynamicConfig)) {
  throw new Error("Watch detail rendering config changed; update prepare-pages before exporting.");
}
await writeFile(detailPage, detailSource.replace(dynamicConfig, 'export const dynamic = "force-static";'));

const serverOnlyRoutes = [
  "src/app/api",
  "src/app/watch/new",
  "src/app/watch/[id]/edit",
  "src/app/calibration",
];

// Seller-private data stays on the machine that owns it. build-static already
// skips copying these; deleting them here also covers any other caller.
const privatePaths = ["data/private.json", "data/listing-drafts"];

for (const path of [...serverOnlyRoutes, ...privatePaths]) {
  await rm(path, { recursive: true, force: true });
  console.log(`prepare-pages: removed ${path}`);
}
