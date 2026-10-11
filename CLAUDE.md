# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A personal Next.js (App Router) + TypeScript + Tailwind app for tracking a watch wishlist. The collection is a single version-controlled JSON file — `data/watches.json` — read and written through `src/lib/store.ts`. There is no database.

## Commands

```bash
npm run check              # validate:data + audit:data + audit:calibers + lint + build — run before proposing a change is done
npm test                   # vitest
npm run dev                # local dev server
npm run validate:data      # schema and plausibility check for watches.json; fast, but not the whole gate
npm run audit:data         # data acceptance criteria (every watch has a category, caliber match rate, …)
npm run audit:calibers     # every recorded mechanical caliber must resolve to a tier
npm run build:static       # GitHub Pages export, into out/
npm run calibrate:scoring  # read-only comparison of current vs proposed scoring
npm run notify:targets     # target-met webhook notifications; use --dry first
```

`validate:data` passing does not mean `check` passes: the two audits gate things validation doesn't, such as a watch added with no scoring category. Run the full `check` before proposing any change to `watches.json`.

## Architecture notes

**`data/watches.json` is the source of truth.** The in-app forms rewrite the whole file, which reorders keys — so a one-field edit can show up as a 500-line diff. When reviewing a change to this file, diff it *semantically* (parse both sides and compare field by field) rather than reading the raw patch, or you will badly misjudge the scope.

**The scoring engine is the opinionated part** — `src/lib/scoring.ts` (standing engine, design score, quadrants) and `src/lib/rubrics.ts` (dimensions, price bands, per-category rubric tables). Three invariants hold it together. They were each arrived at by fixing a bug where the opposite behavior misled, so preserve them:

1. **Missing data is never a zero.** A dimension without source data returns `undefined` and is excluded from the composite. `unratedReason()` explains which input is missing. Never substitute a neutral or mid value to "fill in" a gap — a fabricated score reads as a measured failure.
2. **Friction is never numeric.** `friction` (availability, bracelet upcharge, brand liquidity) renders as text chips via `frictionChips()`. It must not enter any score.
3. **Par is absolute.** A watch at par for its price scores 0.5. Par is a fixed line per dimension (`PAR` in `rubrics.ts`), the same for every category, so value compares across categories; its anchors are frozen constants, never refitted as watches are added. Peer groups range from a single watch to about ten, so they supply only the label and count; percentile ranking is gated behind `n >= 6`.

**Value is built from three core dimensions** — movement, case profile, durability (`VALUE_DIMENSIONS`) — and is unrated unless all three are rated, so a quartz watch has no value score. Par rises 10 points per price doubling across them. caseCraft and bracelet show on the standing panel but stay out of value, because their inputs are recorded only when a brand publishes them.

`unratedReason()` mirrors the gates in `scoreDimensions()`. Change one and the other must follow.

**Quality flags are tri-state: omitted is not false.** Each `qualityFlags` input counts only when recorded (`!== undefined`). `true` earns credit, an explicit `false` is recorded evidence of absence, and an omitted flag leaves its input unknown — it lowers evidence coverage, never the score. A stated AR layer count (`arLayers`) outranks a plain `arCoated`, so never reduce a count to the boolean. `withCrystalArInference()` in `src/lib/quality-flags.ts` fills an unset `arCoated` from crystal text that states AR, and runs on save (`addWatch` / `changeWatch`), not at score time; an explicit value always wins.

**`priceHistory` records moves, not polls.** `appendSnapshot()` in `src/lib/price-history.ts` is a no-op when the price is unchanged, so consecutive entries always differ and each `date` means "unchanged since". Consumers rely on the series being oldest-first with the newest entry equal to `price`; both validators enforce that. Don't add a snapshot per scrape run — it would add a line per watch per run to `watches.json` and destroy the meaning of the dates. `updateWatch()` appends automatically on a price change, so callers should not build the series by hand unless they are importing one (passing `priceHistory` explicitly suppresses the automatic append).

**A link's `askHistory` follows the same moves-only rule, per listing URL.** `recordAskMove()` in `src/lib/listing-history.mjs` (shared with `enrich-watches.mjs`) appends only when that link's ask changes; `observedAt` still advances on every confirmation, so the two dates mean different things. A changed ask that arrives with the old `observedAt` (the form sends an untouched date back as `YYYY-MM-DD`) is re-dated to now, since that date belongs to the previous ask. The form never sends `askHistory`, so `updateWatch()` carries trails across edits by URL. A currency change restarts the trail rather than comparing through a rate snapshot.

**Alerts fire on change, never on read.** `detectAlerts(before, after)` in `src/lib/alerts.mjs` compares a watch before and after a write; `updateWatch()` and `enrich-watches.mjs --refresh` are the two callers, and both go through `appendAlerts()` for the 24h dedupe, mutes and type switches. Don't compute alerts from current data at page load: every refresh re-dates every link, so a read-time feed can't tell a new offer from a re-checked one. The log is `data/alerts.json` (committed, read-only on Pages). Adding a watch or editing its target never fires an alert. `watchAlertStatus()` in `src/lib/alert-status.ts` explains per watch which types can fire; it mirrors the gates in `detectAlerts()`, so change them together.

**Calibers have two tables.** `src/lib/caliber-aliases.mjs` owns *naming* — how free-text caliber strings normalize to a canonical key, shared with the audit scripts. `CALIBER_TIER_PATTERNS` in `scoring.ts` owns *worth* — a hand-maintained substring table, ordered most-specific-first. Unknown calibers return `undefined` (unrated), never a fallback tier. Adding watches from new movement families means adding entries to both; `audit:calibers` fails on a recorded caliber that doesn't resolve.

**`src/lib/spec-ranges.mjs` is `.mjs` on purpose** — it's imported by both the TypeScript app and `scripts/validate-data.mjs`, which runs under bare Node with no build step. Don't convert it to `.ts`.

**The scraper must stop where the product ends.** `productExtractionText()` / `primaryProductText()` in `src/lib/scrape.ts` choose the page text that autofill reads. A spec section starts at a technical heading or anchor (EN, DE, FR, ES, IT) and ends at a `PRODUCT_END` marker (reviews, testimonials, cross-sells, FAQs). Text past that point has produced real false values — flags from customer reviews, another model's sapphire bezel, a GMT from a review of a different watch. When a page leaks, add a narrow end marker and a trimmed fixture in `src/lib/fixtures/` rather than loosening a spec pattern. Extraction never invents: prefer a blank field plus the coverage note (`specCoverage()`) to a guessed value. Before committing scraped data, compare the saved values against the source page.

**Seller-private data never enters `watches.json`.** The repo is public and the static export ships page data to the browser, so what you paid (and later minimums, buyers, fees — `docs/briefs/11-selling-first-slice.md`) lives in git-ignored `data/private.json` via `src/lib/private-store.ts`. Pages read it *beside* the watch, never merged into the `Watch` type, and the store returns nothing when `IS_STATIC`. `validate:data` and the patch validator reject a `purchase` on a watch. `build:static` skips the file, `prepare-pages` deletes it, and `scripts/check-export.mjs` fails the build if a private key or stored value appears in `out/` — add any new private field name to its `PRIVATE_KEYS`.

**Selling is a layer on `owned`** (`src/lib/sale-store.ts`). A *draft* listing lives only in `private.json`, photos as data URLs; publishing (live/reserved) moves it to `watch.listing` in `watches.json` and writes its photos to `public/listings/<id>/`, named by content hash. So drafts can't reach git or Pages by construction — don't add a "draft" state to `watch.listing`. `listing` is refused through the generic add/edit API; only the Sell panel's route writes it. Your own ask (and its cross-postings) is never a `RetailerLink` and never enters valuation, alerts or price history. Mark sold appends your sale as a `SoldComp` (public price and date; fees, shipping and buyer stay private). Net proceeds go through `netProceeds()` in `src/lib/proceeds.ts`: a missing fee or shipping cost makes the net unknown, never the gross. Seller contact for the For-sale page is the public `data/seller.json` (see `seller.example.json`).

**Static export.** `IS_STATIC` (`NEXT_PUBLIC_STATIC=true`) drops dynamic rendering and hides write actions. `npm run build:static` (`scripts/build-static.mjs`) copies the repo to a temp directory, where `scripts/prepare-pages.mjs` deletes `src/app/api`, `watch/new`, and `watch/[id]/edit` before building — Pages can't run a server. Any new server-dependent route needs handling in both places.

**Spec fields are declared once** in `src/lib/specs.ts` and drive the form, detail view, and comparison table together. Add a field there, not in three components.

## Data-maintenance scripts

`scripts/enrich-watches.mjs` (scrapes prices/images) and `scripts/backfill-specs.mjs` (fills specs via the Claude API with web search; needs `ANTHROPIC_API_KEY`) require **real outbound network access**. The cloud sandbox blocks retailer domains through its egress proxy — every fetch returns 403. Run them locally, and use `--dry` first.

Both are conservative: they fill gaps and never overwrite. Keep it that way. They write `watches.json` directly, so store-level save rules such as `withCrystalArInference()` don't apply to them.

`scripts/notify-targets.mjs` sends target-met notifications to `WATCH_NOTIFY_WEBHOOK_URL` (`WATCH_NOTIFY_WEBHOOK_FORMAT`: generic, slack or discord) and records what it sent in `data/notify-state.json`. `--refresh` runs the enrich script first; `--dry` sends nothing. `scripts/calibrate-scoring.ts` compares current and proposed scoring and never writes data.

## Conventions

- Comments explain *why*, especially in the scoring code, where several constants encode a decision that a plausible-looking alternative got wrong. Match that density — don't strip the rationale comments.
- Work on a branch off `main` (the default branch), not directly on it.
- `.github/workflows/deploy-pages.yml` triggers on `main` alone — it is the single branch that publishes. Renaming the default branch means updating that trigger.
- Implementation briefs live in `docs/briefs/`, with shared constraints in `00-working-agreements.md`. When a brief asserts how the engine behaves, measure it before building on the claim.
