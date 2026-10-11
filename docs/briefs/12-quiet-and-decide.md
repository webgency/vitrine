# 12 — Quiet the empty surfaces, then help decide

**PR titles:** see the four slices below; one PR each, in order.
**Depends on:** 08 (tiers), 10 (evidence coverage), 11 (ownership panels)
**Refs:** `docs/briefs/00-working-agreements.md`; `docs/workflow-ux-review.md` (all three of its PRs shipped); `src/components/WatchCard.tsx`, `ValueList.tsx`, `DecisionSummary.tsx`, `SellPanel.tsx`, `PurchasePanel.tsx`, `TradeUpPanel.tsx`, `MarketChapter.tsx`; `src/lib/scoring.ts` (`computeStanding`, `assignQuadrant`), `src/lib/store.ts` (`addWatch`)

Comes from an expert walkthrough on 2026-10-11 against `main` at `f79c752`. I walked every page at 1280px and 375px against the owner's live data, and ran `computeStanding()` over `watches.json`. It is not a usability study. The numbers below were measured that day and will drift, so re-measure before relying on one.

## Finding

The evidence engine is honest, but the data rarely clears its bars. So a large share of the UI explains why something can't be shown yet:

| Surface | Needs | Data on 2026-10-11 |
|---|---|---|
| Deal score (Value column, detail tile) | 2 dated asks from different hostnames, same condition | Every watch has exactly **1** link, so **0 of 82** qualify |
| Per-listing ask trail | Repeat checks of a listing | **0** links have `askHistory` |
| Solds | Hand-entered sales | **0** |
| Target-met alerts | A target | **3** watches |
| Exit range / trade-up / suggested ask | 2 pre-owned asks | **0 of 3** owned watches |
| "Shortlist" | A short list | **46 of 79** wishlist watches |

The owner endorsed a rule during brief 03: *don't reserve permanent layout space for a figure that is usually zero; surface it when it fires.* Several surfaces now break that rule. And nothing in the app answers the question the product exists for: **which watch next?** (README north star: "Vitrine helps you decide the next move.")

## Rules

These carry over from CLAUDE.md, and every slice must preserve them:

1. **Hiding is not substituting.** When a surface collapses for lack of data, nothing replaces it with an estimate. Missing stays missing. It just stops taking up space.
2. **No blended "decision score."** Value, quality, design, fit and deal stay separate axes. The Decide view arranges them side by side; it never sums them.
3. **No shrinkage toward par.** Scores with thin evidence are *labelled and grouped*, never pulled toward 0.5. That would be a fabricated value (invariant 1).
4. **Friction stays text.**
5. **Data cleanup is reviewed, never silent.** Any one-off rename or retag goes through a data PR. Show the owner the semantic diff first.

---

## Slice A — Quiet the surfaces

**PR:** `ui: collapse empty evidence surfaces and always-on badges`

| # | Today | Change |
|---|---|---|
| A1 | Value table spends a column on "Deal vs fair asks", which reads "Insufficient" on every row (`ValueList.tsx:168`, `:267`). | Render the column, the "Deal: best discount" sort and the "Has sufficient deal evidence" filter only when at least one watch has `deal.status === "available"`. Decide over all rows, not the filtered ones, so the column doesn't appear and vanish as filters change. A deal sort or filter restored from a URL falls back to value / off. |
| A2 | The detail page's decision tiles always include "Deal · Needs more data" (`DecisionSummary.tsx:33`). | Drop the tile when deal is unavailable. Market already explains the gap. |
| A3 | Card restates the headline price as "Best offer $599 · av86.com" whenever the best offer is that same link (`WatchCard.tsx:115`). It shows "Fresh · Today" on 74 of 82 cards, and the condition "New" on nearly all. | Show the offer row only when it says something new: a different seller below the tracked price, a stale offer, or a non-new condition. Otherwise omit it. Freshness shows only when the offer is no longer fresh; condition only when it isn't a matched "new". |
| A4 | Owned detail stacks Market, Alerts, Trade-up, Sell and Purchase, mostly "Insufficient / Not recorded". "What you paid" appears twice (`SellPanel.tsx:59`, `PurchasePanel.tsx:115`). Notes sit at the bottom. | One **Ownership** section with a to-do list of the missing inputs, each with its inline action (see mockup §4). A panel expands into its full form once it has something to show. "What you paid" appears once. Notes move up beside the headline. |
| A5 | At 375px the collection header, four stat tiles and the filter card fill the first screen. No watch is visible. | Stats become one line of text. Priority and sort move into a filter sheet behind one button; status pills stay. At least the first card image must start above the fold at 375×812. |
| A6 | The Design page says its score is "the vertical axis of the value matrix" and links to `/value`. The matrix was removed in `03f6359`. | Reword now. Slice C gives the quadrant a home again, and the link points there. |
| A7 | Standing rows read "Durability 75 · Below expected" next to "Case profile 35 · As expected". This is correct (it's measured against a par tick), but it looks contradictory in text. | Write the reference in words: "75 · expected 82". Keep the tick. |

**Acceptance:** with today's data the Value table has no Deal column. Add a fixture watch with two qualifying asks and the column returns. No card shows a best-offer row identical to its headline price. Owned detail shows "What you paid" exactly once. 375px screenshot shows a card above the fold. `npm run check` passes.

---

## Slice B — Hygiene on the way in

**PR:** `feat: normalize names and tags on save, warn on duplicate add`

| # | Today | Change |
|---|---|---|
| B1 | About 12 models carry retailer text ("GMT-Master II watch - m126710blnr-0002", "Argo Bronze 200M Automatic Diver Watch PY057B…", "TISSOT GENTLEMAN 38MM"). Two brands are stored all-caps ("OLTO-8 WATCHES", "FIYTA"). | Autofill proposes a cleaned model: strip a trailing reference that equals `referenceNumber`, a trailing " Watch", and size suffixes duplicated in specs. The scraped original stays visible in the form, so the owner can choose. Never auto-rewrite on save. |
| B2 | Tags "GMT" and "gmt" both exist. Scoring is unaffected: `deriveCategory()` lowercases. But chips and the tag list show duplicates. | Lowercase and trim tags on save (`addWatch` / `changeWatch`), like `withCrystalArInference()`. Display casing comes from a small label map. |
| B3 | `addWatch()` (`store.ts:53`) has no duplicate check. Pasting a URL already tracked creates a second watch silently. | Before save, match on normalized link URL, then on brand + reference. Show "Already tracked as …" with Open and Add anyway. It's a warning, not a block. |
| B4 | The Add form's placeholders ("Omega", "Seamaster Diver 300M", a real ref) read as pre-filled at a glance (`WatchForm.tsx:405-413`). | Use clearly example-styled placeholders ("Brand, as on the dial") or drop them. |

**One-off data PR (separate, owner-reviewed):** apply B1 and B2 to existing watches. Present the rename list for approval first.

**Acceptance:** tests for name cleanup (each example above), tag normalization, and duplicate detection by URL and by ref. No existing `watches.json` value changes in the code PR.

---

## Slice C — Finalists and a Decide view

**PR:** `feat: finalists and decide view`

- **C1 Finalists.** A personal `finalist?: boolean` on wishlist watches, capped at 5 by the UI. It lives outside `wishlistTier`, so the alert gates in `alerts.mjs` (tier-dependent since brief 08) don't move. Pin and unpin from the card's priority menu and from Decide. Never scored.
- **C2 `/decide`.** One column per finalist (mockup §2) showing:
  - price and target gap;
  - value, quality, design and fit as separate figures;
  - evidence coverage and friction chips;
  - the quadrant from `assignQuadrant()`, revived with today's medians as thresholds;
  - a to-do list of the missing inputs that would change the picture (second seller, target, unrated dimensions), each linking to the existing inline editors.
  
  Empty state: "Pin up to five finalists from the collection." Nav pill appears only once a finalist exists (same pattern as Alerts).
- **C3 Provisional evidence in Value.** On 2026-10-11, 5 of the top 10 by rubric value had under 45% evidence coverage. The Riley FlyRacer ranked #6 rated on two dimensions at 20%. Group means barely differ (0.618 vs 0.584), but with fewer rated dimensions scores spread to the extremes. Mark these rows **provisional**. The open question 2 below decides how. Offer "Fill specs" for the provisional rows in the top 10. Locally this can trigger `scripts/backfill-specs.mjs --dry` for those ids; on Pages it's hidden.

**As built (PR for slice C):**
- **Provisional threshold:** reuses the existing "low" confidence line (coverage under 50%) via `isProvisional()` beside `confidenceFor()`, the same line the Value page's "Low evidence" hint already used, rather than a second threshold.
- **Fill specs:** shown as the exact `backfill-specs.mjs --dry --id=…` command for the provisional watches that would otherwise rank in the top ten, local only. Running the script from a server request would spend API calls and write `watches.json` outside a terminal.
- **Cap enforcement:** in the store under the write lock, not only the UI. The generic edit API refuses `finalist`.
- **Auto-unpin:** a finalist is unpinned when it leaves the wishlist or is marked Pass.

**Acceptance:**
- Pinning a sixth finalist explains the cap.
- Decide renders with 0, 1 and 5 finalists.
- No number on Decide is derived from more than one axis.
- `assignQuadrant` has a non-test caller again.
- Provisional threshold comes from a named constant beside `confidenceFor()`, not a literal.

---

## Slice D — Second sellers for finalists

**PR:** `feat: evidence to-do for finalists`

The deal score, ask trails and trade-up only work once a watch has a second dated ask from a different seller. Asking the owner to do that for 79 watches is unrealistic; doing it for 5 finalists is fine.

- Decide's "Second seller · Add" opens the existing shared listing editor (`ListingEditor.tsx`) with the watch named and the condition preselected.
- After save, the column updates in place. Once two qualify, deal appears there and Slice A's conditionals bring it back elsewhere.
- **Out of scope:** any crawler or bulk lookup (00: "Bulk Chrono24/eBay crawlers"). Suggesting likely sites as plain links (the brand's AD list, Chrono24 search URL for the reference) is fine. Fetching them is not.

**As built:**
- **The task:** each column's "Another {condition} seller's price" names the sites that already count and opens the shared `ListingEditor` inline, with the deal's preferred condition preselected.
- **Search links:** Chrono24 and a web search, built from brand and reference. There's no brand AD list, because the data records none and inventing dealer URLs would break "never invent".
- **On Pages:** it stays a link to the watch's Market section.

**Acceptance:** from `/decide`, add two independent asks to one finalist without leaving the page. The deal figure appears there and on the Value table.

---

## Decisions (owner, 2026-10-11)

1. **Card offer row (A3):** omit it when it repeats the headline price.
2. **Provisional rows (C3):** grouped below the ranked list behind a disclosure, not badged in place.
3. **Finalist cap:** 5.
4. **Still open — Rolex GMT-Master II:** rolex.com's $12,000 shows as a fresh best offer though it isn't buyable at retail. Whether to set `friction.availability` on it is a data decision for the owner; only 5 watches record any friction.

## Out of scope

Scoring math, rubric tables, valuation gates (the 2-source rule stays), selling flows beyond the A4 layout change, alerts logic, Pages deploy.
