# Vitrine

A personal app to **track your watch wishlist, judge each watch against its price, and grow your collection** over time.

Built with Next.js (App Router) + TypeScript + Tailwind CSS. Your collection lives in a single, version-controlled JSON file (`data/watches.json`) — no database to set up, easy to back up, and you can literally commit your wishlist.

The collection is stored in `data/watches.json`; the current count changes as the wishlist grows.

---

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

Validate, lint, and build in one go:

```bash
npm run check
```

---

## What it does

### Browsing and editing

- **Collection view** — switch between cards and a compact research table without losing search, filters, sorting, or comparison selections, with search, status/priority filters, and sorting by wishlist priority, rubric value, quality score, recently added, price, brand, or case size.
- **Wishlist tiers** — Next purchase, Must have, Love it, Interested, Maybe later, or Pass.
- **Add / edit watches** — one form covering basics, URL autofill, specs, image, multiple retailer links, tags, and notes.
- **Side-by-side comparison** — select 2+ watches and compare them in a spec/price table, with the best value in each row highlighted.
- **Per-watch detail page** — full specs, retailer links, notes, specification standing, deal-vs-market evidence, and price history.
- **Price tracking and alerts** — set a target price per watch; the collection flags it in-app, and the local notifier can send a webhook when a fresh tracked, landed, or best-offer price reaches it. Every price change is recorded as a history entry, with the latest move and lowest recorded price shown on the detail page.
- **Dashboard stats** — totals by status and wishlist tier.

### Scoring

The app's opinionated half. It answers "is this watch good *for its money*?" while keeping your taste separate from the arithmetic.

- **Rubric value / specification standing** (`/watch/[id]`) — five dimensions (movement, case features, wearability, durability, bracelet) scored 0–1 against a continuous expectation for the watch's exact USD-normalized price and category (diver / chronograph / GMT / dress / sports). The fixed price-band rubrics are log-price interpolation anchors; bands remain useful peer labels, but crossing an edge no longer changes the expectation abruptly.
- **Deal vs fair asks** (`/watch/[id]`) — compares the tracked or landed ask with the median of at least two dated, independent, condition-matched retailer asks. It reports the fair range, source ages, and confidence. Thin evidence is explicitly insufficient and never produces a discount percentage. If only the other condition has enough evidence, the UI identifies that fallback instead of pooling conditions.
- **Best dated offer** — selects the lowest USD-normalized dated retailer ask after preferring the tracked/deal condition. Detail, collection cards, and comparisons show the source, condition, age, and freshness. Undated prices never win; a fallback or unknown condition is labeled rather than assumed.
- **Design rank** (`/design`) — your own 1–5 read on how a watch looks. Deliberately the one judgement in the app that is yours rather than calculated.
- **Value-for-money ranking** (`/value`) — a searchable, sortable, filterable list led by rubric value. Search brand, model, reference, or caliber within the current filters. Confidence shows how much applicable scoring evidence is recorded; low coverage reads as limited evidence, never bad value. On mobile, cards show value, price, and deal evidence, with expandable coverage and offer/spec/design details; search and sort stay visible while additional filters can be collapsed. Desktop keeps the comparison table. Deal score and design remain separate measures and filters rather than inputs to rubric value.

The former design × value quadrants were removed from `/value`: they let a subjective design axis create headline purchase labels even when rubric evidence was thin. Design still has its own ranker and remains visible and sortable, but it does not change rubric value, deal percentage, or the value-for-money call. Wishlist priority is likewise context and a filter only.

Three principles hold the model together, and they're worth preserving if you extend it:

1. **Missing data is never a zero.** A dimension without source data comes back `undefined` and is excluded from the composite — the UI shows "unrated" with the reason, rather than a score the data doesn't support.
2. **Friction is never numeric.** Availability, bracelet upcharges, and thin secondary markets render as text chips and never enter a score.
3. **Par is absolute, not relative.** A watch at the continuously interpolated rubric expectation for its exact price scores 0.5, so the split neither drifts as watches are added nor cliffs at a band edge. Peer groups here are small (2–4 watches), so percentile ranking only appears once a group has n ≥ 6.
4. **Market evidence is never invented.** The headline tracked price is the subject of the deal comparison, not another market observation. Fewer than two independent dated asks returns `insufficient` rather than a precise-looking estimate.

Offer freshness is based on whole days since `observedAt`: **fresh** ≤7 days, **aging** 8–30, **stale** 31–90, and **expired** >90. A market median takes the tier of its oldest included observation so aging evidence cannot hide behind one recent source. Best-offer target cues compare the listed retailer price only; per-offer shipping and duty are not stored, so the UI never attributes the watch-level `landedPrice` to a retailer without provenance.

To move a deal score out of **insufficient**, record at least two `links[]` asks with `price`, `observedAt`, and the same `condition`, each from a distinct hostname. A manufacturer, authorized dealer, retailer, or public asking-price listing can qualify; a sold comp is neither required nor scraped. Repeated links from one hostname count once, condition-unknown links do not enter a condition median, and the headline tracked `price` never counts as another source. The add/edit form supports recording these sources manually when a retailer blocks extraction.

---

## Data model

Each watch (`src/lib/types.ts`):

| Field | Notes |
| --- | --- |
| `brand`, `model` | required |
| `referenceNumber` | optional |
| `status` | `wishlist` \| `owned` \| `sold` |
| `wishlistTier` | next purchase, must have, love it, interested, maybe later, pass |
| `designUniqueness` | your separate 1–5 design rank; visible and filterable on the value list but never mixed into rubric value |
| `price` | `{ amount, currency }` — the headline price you're tracking |
| `priceUpdatedAt` | ISO timestamp, set by the enrich script |
| `priceHistory[]` | every distinct price seen, oldest first — appended to only when the price actually moves |
| `targetPrice` | "ping me under $X"; compared against the all-in landed price |
| `landedPrice` | all-in cost (base + bracelet delta + shipping + duty); falls back to `price` |
| `links[]` | retailer links, each with optional dated price + `new`/`pre-owned` condition; qualifying independent links provide market evidence |
| `specs` | case diameter, thickness, lug-to-lug, lug width, material, movement, caliber, power reserve, water resistance, crystal, dial, bracelet/strap, complications |
| `qualityFlags` | verifiable engineering details feeding the score — regulation, accuracy spec, coating hardness, antimagnetism, sapphire bezel, drilled lugs, micro-adjust clasp, quick-release, bracelet included, AR layers |
| `friction` | availability, expected ship date, bracelet upcharge, brand liquidity — **never** folded into a score |
| `scoringCategory` | Explicit `diver`, `gmt`, `chronograph`, or `dress` rubric; use this for hybrid watches |
| `tags[]` | Descriptive labels; a single unambiguous legacy category tag can still infer `scoringCategory` |
| `notes` | free text |
| `purchase`, `sale` | filled in as a watch moves through `owned` → `sold` |

Spec fields are defined once in `src/lib/specs.ts` and drive the form, detail view, and comparison table — add a field there and it appears everywhere.

### Editing data directly

Edit `data/watches.json` by hand, or use the in-app forms (which write to the same file via the API in `src/app/api/watches`). Validate hand edits before committing:

```bash
npm run validate:data
```

This checks enum values, types, and **spec plausibility** (`src/lib/spec-ranges.mjs`) — it will reject a 200mm case or a lug-to-lug shorter than the diameter.

To list missing and unrecognized mechanical calibers without assigning guessed tiers:

```bash
npm run audit:calibers
```

---

## Data-maintenance scripts

All need real outbound network access, so run them from a local terminal. The cloud sandbox routes traffic through an egress proxy that blocks retailer domains.

```bash
node scripts/enrich-watches.mjs --dry
```

Scrapes price and image from each watch's retailer links. `--dry` reports only; `--force` overwrites existing values; `--id=foo` limits to one watch.

**`--refresh` refreshes market asks and builds price history.** It checks every retailer link and writes `price` + `observedAt` only on the exact link that returned that ask, giving deal score and best offer dated evidence without copying the headline price into the market set. Explicit schema condition wins; a clearly first-party manufacturer hostname is tagged `new`, a pre-owned URL/structured condition is tagged `pre-owned`, and everything else remains unknown for manual review. Retailer asks are stored in the page's native currency and normalized through the documented rate snapshot; an unexpected currency does not rewrite the headline tracked price unless `--allow-currency-change` is passed. An unchanged link price still advances `observedAt` because that field means "last confirmed"; headline `priceHistory` remains moves-only, so an unchanged tracked price never adds a snapshot. The default run only fills headline/image gaps. Run refresh on a schedule to keep offers current and accumulate tracked-price moves:

```bash
node scripts/enrich-watches.mjs --refresh
```

Use repeatable `--id=` arguments for a shortlist dry run. A failed targeted extraction prints a structured reason such as `no-priced-product-data`, `no-unambiguous-collection-price`, or `missing-price-currency` instead of silently dating an assumed value:

```bash
node scripts/enrich-watches.mjs --refresh --dry --id=watch-id --verbose
```

### In-app alerts

The **Alerts** page lists targets met, listing price drops, and fresh offers. Each alert cites its source, condition, and the date the price was seen. Alerts fire when something changes: an edit in the app, or `node scripts/enrich-watches.mjs --refresh`. Opening the page never creates one.

- **Target met:** a dated ask, or your tracked or all-in price, reaches `targetPrice`. Setting or changing the target doesn't fire one.
- **Price drop:** a listing's ask falls 5% or more below its highest recorded ask since the last drop alert for that listing. This needs the link's `askHistory`, which builds up as asks change.
- **Fresh offer:** a new dated ask, or one confirmed again after going stale (over 30 days), on a wishlist watch rated *interested* or above.

Adding a watch never fires an alert. There's at most one alert per watch and type per 24 hours, unless the price is lower than the last one announced. On the page you can mute a watch, switch a type off, and mark alerts read. Those settings and the log live in `data/alerts.json`, which is committed so the published site shows the same feed read-only. The **Alerts** tab stays in the nav even with an empty or fully muted feed, so settings and unmute controls remain reachable. `enrich-watches.mjs --refresh --dry` lists the alerts a refresh would record without writing anything.

### Trade-up on owned watches

Open an owned watch and use **Trade-up** to choose a wishlist candidate. The exit range uses at least two independent, dated pre-owned asks. Use **Add pre-owned listing** right in the panel: enter the URL, asking price/currency, condition, and the date you saw the price. Before saving, the form shows whether the listing counts and how many qualifying sources will remain. **Listings used and excluded** explains gaps and provides **Edit listing** actions. New retail and purchase prices cannot fill missing exit evidence.

The same inline editor is available in **Market → Asks**. It changes only the selected listing, preserves other links and price history, and keeps your draft on failure. Another listing on the same site does not add another independent source. A changed price requires you to supply its observation date again; use **I checked it today** only when you actually did. Candidate and ask/target selections stay in the URL and are remembered per owned watch in the browser session, so saving, reloading, or visiting another page does not restart the comparison.

Compare the candidate's best dated ask or, when recorded, your target. The bridge subtracts the exit median from that amount; a negative result means the candidate costs less. The range, confidence, freshness, and source dates remain visible. Targets are planning amounts, asks are not confirmed sale proceeds, and fees, shipping, tax, and duty are excluded. Choosing a candidate does not change priorities or scores. On the read-only published site, comparisons still work; listing changes are made in the local app and appear after republishing.

### Target-price notifications

Set `targetPrice` in the add/edit form, refresh the dated evidence, then preview exactly what would be sent:

```bash
node scripts/enrich-watches.mjs --refresh
npm run notify:targets -- --dry
```

For delivery, set a webhook URL and run without `--dry`. Generic JSON is the default; Slack and Discord payload shapes are also supported:

```bash
WATCH_NOTIFY_WEBHOOK_URL=https://hooks.example/your-webhook npm run notify:targets
WATCH_NOTIFY_WEBHOOK_FORMAT=slack WATCH_NOTIFY_WEBHOOK_URL=https://hooks.slack.com/... npm run notify:targets
WATCH_NOTIFY_WEBHOOK_FORMAT=discord WATCH_NOTIFY_WEBHOOK_URL=https://discord.com/api/webhooks/... npm run notify:targets
```

`npm run notify:targets -- --refresh` runs the enrich refresh first, then evaluates the saved data. Repeatable `--id=watch-id` arguments limit both steps to a shortlist. The optional `WATCH_APP_BASE_URL` changes the detail-page link in the message; it defaults to the GitHub Pages site.

The notifier evaluates tracked/landed and best-dated-offer signals separately and labels each trigger. Every signal must be dated and at or below the target: current-price freshness comes from `priceUpdatedAt` (or the matching latest tracked-price history entry), while an offer uses its own `observedAt`. Fresh (≤7d), aging (8–30d), and stale (31–90d) evidence can alert; expired evidence (>90d) is skipped by default. `--include-stale` is an explicit override that also admits expired evidence. An undated link is never promoted to an alert, and a retailer's listed price is not described as landed because offer-specific shipping and duty are unknown.

Successful sends are deduplicated by watch + trigger + exact price in the gitignored `data/notify-state.json`; a changed price can notify again. The file is written atomically only after a successful webhook response. [`data/notify-state.example.json`](data/notify-state.example.json) documents its small, local shape. Preserve the state file between scheduled runs—on a CI runner, restore/save it with a cache or artifact—to avoid repeat alerts.

A local cron or launchd job can run the refresh-and-notify command on a schedule with `WATCH_NOTIFY_WEBHOOK_URL` in its environment. CI can do the same with the URL in repository secrets and outbound access to retailer sites, provided it persists notification state. GitHub Pages itself is static and read-only: it cannot scrape, retain dedup state, or push a notification.

```bash
node scripts/backfill-specs.mjs --dry --limit=5
```

Fills missing specs, tags, and quality flags via the Claude API with web search. Conservative by design: only fills gaps, never overwrites, and drops implausible readings. Needs `ANTHROPIC_API_KEY`. `friction` is deliberately excluded — it goes stale too fast and `brandLiquidity` is a judgement call.

```bash
node scripts/backfill-prices.mjs
```

One-off estimated prices for retailers whose bot protection defeats the scraper. Skips any watch that already has a price.

---

## Deploying to GitHub Pages (auto-published, read-only)

`.github/workflows/deploy-pages.yml` builds a **static, read-only** export and deploys it on every push:

**https://webgency.github.io/vitrine/**

How it works:

- `npm run build:static` builds from a temporary prepared copy with `NEXT_PUBLIC_STATIC=true`, which switches Next.js to `output: 'export'` and adds the `/vitrine` base path (see `next.config.mjs`).
- `scripts/prepare-pages.mjs` strips the server-only routes from that copy — Pages can't run a server.
- Write actions (Add / Edit / Delete) are hidden, and `/design` shows a "needs the live app" placeholder since ranking writes to disk.

**One-time setup:** enable Pages under **Settings → Pages → Source: GitHub Actions**.

**Editing stays local:** add or edit watches with `npm run dev`, commit `data/watches.json`, and push — the site rebuilds automatically.

Preview the static build locally:

```bash
npm run build:static && npx serve out
```

---

## Roadmap

**Phase 2 — Price & value** *(partly done)*
- ✅ Continuous exact-price rubric value scoring and a sortable value-for-money ranking
- ✅ Condition-aware deal comparison against dated independent asking prices, with an explicit insufficient state
- ✅ USD normalization for scoring, covering every currency the form offers — rates are a dated snapshot in `src/lib/currency-rates.mjs`, refreshed by hand (the file says how); a live rate source would remove the drift entirely
- ✅ Price-history snapshots per watch + webhook target-price alerts with freshness and deduplication
- ✅ Best dated offer across retailer links, with condition fallback, freshness, and target-price cues

**Phase 3 — Collection management**
- ⬜ Richer dashboard: total spent, value by brand/movement, size distribution
- ⬜ Overlap detection ("you already have a 39mm diver")
- ⬜ Service-history reminders; insurance/valuation CSV/PDF export

**Phase 4 — Convenience**
- ⬜ CSV / JSON import-export + backup
- ⬜ Mobile / PWA so you can check it in-store
- ⬜ Shareable read-only wishlist (gift hints)

---

## Notes for later

- **Auto-fetching specs from links:** the add form scrapes the retailer page when you paste a URL. Needs open outbound network access, so it works best on your own machine.
- **Editing online (instead of read-only Pages):** the JSON-file store writes to disk, which works locally and on a long-running server but **not** on serverless/static hosts. For a fully editable online version, deploy to a server host (Render / Fly / a VPS) or swap `src/lib/store.ts` for a database (SQLite / Postgres / Turso) — the function signatures stay the same, so nothing else changes.
- **Exchange rates go stale:** `src/lib/currency-rates.mjs` is a dated snapshot, not a feed. Drift changes the exact USD price used by the continuous rubric and deal comparison. `npm run validate:data` warns once the snapshot passes `RATES_STALE_AFTER_DAYS` (90) *and* you hold something priced in a non-USD currency — it stays quiet otherwise, since drift can't affect an all-USD collection. The file documents the one-liner to refresh.
- **Caliber coverage:** `CALIBER_TIER_PATTERNS` in `src/lib/scoring.ts` is a hand-maintained substring table, with shared naming aliases in `src/lib/caliber-aliases.mjs`. An unrecognized mechanical caliber leaves `movement` unrated rather than guessing. Run `npm run audit:calibers` after adding watches; missing calibers are listed as research work, while recorded-but-unrecognized calibers fail the audit.

---

## Project structure

```
src/
  app/
    page.tsx                 # collection
    compare/page.tsx         # side-by-side comparison
    value/page.tsx           # sortable value-for-money ranking
    design/page.tsx          # design ranker
    watch/new/page.tsx       # add form
    watch/[id]/page.tsx      # detail + standing panel
    watch/[id]/edit/page.tsx # edit
    api/watches/...          # REST API (GET/POST/PUT/DELETE) + /scrape
  components/                # CollectionView, WatchCard, CompareTable, WatchForm,
                             # ValueList, DesignRanker, StandingPanel, ...
  lib/
    types.ts                 # domain model
    scoring.ts               # standing engine, design score, legacy quadrant helper
    rubrics.ts               # dimensions, price bands, per-category rubric tables
    store.ts                 # JSON-file persistence
    validation.ts            # runtime input/data validation
    specs.ts                 # spec field definitions
    spec-ranges.mjs          # plausibility bounds, shared with validate-data
    scrape.ts / extract.ts   # retailer page fetching + field extraction
    config.ts                # IS_STATIC flag
    format.ts                # currency / date helpers
data/
  watches.json               # your collection (version-controlled)
scripts/                     # enrich, backfill, validate, static-build helpers
```

Tests live next to their subjects (`src/lib/scoring.test.ts`, `src/lib/extract.test.ts`) and run with `npm test`.
