# PRD — Vitrine P1: Market intel + trade-up

**Product:** Vitrine (`webgency/vitrine`, formerly `watch-researcher`)  
**Owner:** Sergio  
**Status:** Draft for implementation  
**Depends on:** P0 UI (priority popover, quieter cards, ordinals) — can parallelize if needed  
**Not this PRD:** full multi-tenant SaaS, Chrono24/eBay bulk scrape at scale, click-to-buy, flip-school positioning, product rename/icon (separate small PR OK)

---

## 1. Problem

Collectors (starting with Sergio) already track wishlist/owned pieces and scoring, but still leave the app to hunt asks, remember targets, and guess whether selling piece A funds piece B. Competitors like Watch Scout package alerts + market scans for *flippers*. Vitrine should deliver the useful half — **evidence-backed asks, comps, alerts, and trade-up clarity** — for people who want to **keep and occasionally trade up**.

## 2. Goals

1. Make **dated, condition-tagged, multi-source market evidence** first-class and actionable in the UI.  
2. Notify when a **target is met** or a **material ask drop** appears on a watched piece.  
3. Surface a **trade-up** view: estimated exit on a hold vs cost of a next-love wishlist piece — informational, never auto-sell.  
4. Shape data so a later **multi-user / Pro** tier can monetize alerts + comps without rewriting scoring.

## 3. Non-goals

- Guaranteed ROI, “wealth transfer,” or beginner flip lists.  
- Inventing sold comps or prices.  
- Full marketplace crawling as v1 (ToS/cost/brittleness).  
- Auth / multi-tenant accounts (called out as P0-for-productize; **schema-ready only** here).  
- Changing rubric/deal *formulas* except where needed to consume richer offer history.

## 4. Users & jobs

| Persona | Job |
|---|---|
| Sergio (dogfood) | Know when to buy/keep/trade up without spreadsheet hell |
| Future collector (Pro) | Same loop on their private collection |
| Explicitly not primary | Full-time flipper optimizing 3-day margins |

## 5. Current foundation (do not break)

Already in repo — extend, don’t reinvent:

- `Watch.links: RetailerLink[]` with `url`, `price`, `condition`, `observedAt`, `retailer`
- `bestOffer` / `dealScore` / `marketValueSummary` require **≥2 independent dated sources**; headline `price` is **not** a second observation
- Freshness tiers on dated offers; target compare is **listed-price basis** (no per-offer shipping)
- `priceHistory[]` tracks distinct headline levels over time
- `targetPrice`, `landedPrice`, `purchase` / `sale`, wishlist tiers, friction/liquidity

## 6. User stories

### Market evidence
1. As a collector, I see on a watch detail page a **Market** section: best dated ask, fair band (when confidence ≥ low), observation count, freshness, and each source with link + condition + as-of.  
2. As a collector, I can **add/refresh an ask** by pasting a product URL (assisted fetch) or manually entering price/condition/date/source — never silent invention.  
3. As a collector, when evidence is thin (`insufficient`), the UI says so plainly and does **not** show a fake deal %.

### Alerts
4. As a collector, I set (or already have) a **target**; I get notified when best dated offer ≤ target (listed basis, labeled as such).  
5. As a collector, I can watch a **specific listing URL** for price drops and see first-seen ask → current ask.  
6. As a collector, I can enable alerts for **wishlist tier ≥ interested** (configurable) when a new dated offer appears or freshness flips to fresh.

### Trade-up
7. As a collector, on an **owned** (or optionally lukewarm wishlist) piece, I see an **Exit range** derived only from available market evidence (or “insufficient”).  
8. As a collector, I can pick a **wishlist next love** and see a simple bridge: exit midpoint (or low/high) vs that piece’s best ask / target — soft FYI, no score mutation.  
9. Overlap / similar-dial notes remain **FYI only** and never touch tiers or scores (existing preference).

## 7. Functional requirements

### 7.1 Offer / observation model
- Keep `RetailerLink` as the unit of ask evidence.  
- Add optional fields only if needed (prefer minimal):
  - `listingId` or stable key (hostname + path hash) for drop tracking  
  - `firstSeenPrice` / `firstSeenAt` **or** derive drop trail from repeated observations of the same URL in history — prefer an explicit `ListingWatch` / observation log if cleaner than overloading `links[]`
- **Sold comps (v1):** new optional `soldComps?: SoldComp[]` on watch **or** parallel store file — each requires `price`, `currency`, `observedAt`/`soldAt`, `source`, `condition`, `url?`. UI separates **Asks** vs **Solds**. No sold → no invented secondary.  
- Deal score stays ask-vs-ask median unless a later PR explicitly adds sold-based bands (out of scope unless easy).

### 7.2 Listing price-drop trail
- For each tracked listing URL: record first observed ask + subsequent lower asks with dates.  
- UI: sparkline or simple “−$X since first seen (date)”.  
- Enrich script / manual refresh may append observations; unchanged price does not spam history (same rule as `priceHistory`).

### 7.3 Alerts (v1 delivery)
- **v1 channel:** email via a simple provider **or** in-app “Alerts” page + optional webhook URL in config — pick the smallest shippable path for single-user first.  
- Alert types: `target_met`, `price_drop` (≥ threshold %, default 5%), `fresh_offer`.  
- Dedupe: one alert per watch+type per 24h unless price improves further.  
- Every alert cites sources and as-of; never claim sold data that isn’t stored.

### 7.4 Trade-up panel
- Inputs: subject watch (usually `owned`), candidate watch (wishlist).  
- Exit estimate: if `marketValueSummary` / deal evidence available for preferred condition (pre-owned default for owned), show low/median/high + confidence + freshness; else “insufficient — add comps/asks”.  
- Bridge line: `candidateBestAskUsd - exitMedianUsd` (or vs `candidate.targetPrice`). Label assumptions (listed, fees/shipping not included).  
- Does **not** change wishlist tiers, rubric, or deal scores.

### 7.5 UI surfaces
- **Watch detail:** Market (asks + solds + drop trail) + Trade-up (owned).  
- **Home cards:** keep quieter P0 hierarchy; show compact “at target” / fresh badge only (no new wall of text).  
- **New `/alerts` or section on `/value`:** recent alerts + mute toggles.  
- Confidence language aligned with detail page (High / Medium / Low / Insufficient).

## 8. Data / API sketch

```ts
// Additive concepts — names flexible
interface SoldComp {
  price: Money;
  condition: Condition;
  soldAt: string;      // ISO
  source: string;      // hostname or label
  url?: string;
  notes?: string;
}

interface ListingObservation {
  url: string;
  price: Money;
  observedAt: string;
  condition?: Condition;
  source?: string;
}

interface AlertEvent {
  id: string;
  watchId: string;
  type: "target_met" | "price_drop" | "fresh_offer";
  createdAt: string;
  payload: Record<string, unknown>; // prices, urls, as-of — structured
  read?: boolean;
}
```

- Single-user v1 may keep JSON files under `data/` (`watches.json`, optional `alerts.json`, optional `listing-observations.json`) with the same enrich-script pattern.  
- Avoid designs that hard-code “one global watches.json forever” for *new* APIs — prefer functions that take `Watch[]` / repos so auth later is a store swap.

## 9. Enrichment / intake

1. **Primary:** paste URL → fetch specs/price when possible (existing manual workaround path).  
2. **Manual:** add link with price, condition, observedAt.  
3. **Batch enrich:** extend current enrich refresh to re-read known links, update `observedAt`/price when changed, append listing observations.  
4. **Never** fabricate Chrono24/eBay solds. If a source blocks fetch, record failure and leave UI honest.

## 10. Success metrics (dogfood)

- Sergio can answer “is this ask fair?” from the detail page without leaving the app for ≥70% of next-purchase / must-have watches that have ≥2 dated links.  
- At least one real **target_met** or **price_drop** alert fires correctly in testing.  
- Trade-up used at least once on a real owned vs wishlist pair with clear insufficient vs sufficient states.  
- No invented prices in UI or tests.

## 11. Implementation phases

| Phase | Ship |
|---|---|
| **P1a** | Market section UI on detail using existing `links` + deal/bestOffer; sold comps model + manual entry; confidence copy |
| **P1b** | Listing observation / price-drop trail + enrich hook |
| **P1c** | Alerts store + target_met / fresh_offer / price_drop; simple delivery |
| **P1d** | Trade-up panel on owned detail |
| **P1e** (optional same epic) | Schema notes / adapter boundaries for future multi-user |

Suggested first PR title: `feat: market panel, sold comps, listing drops (P1a–b)`  
Follow-ups: `feat: alerts` · `feat: trade-up panel`

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scrape ToS / blocks | URL paste + manual; graceful failure |
| Overconfident deal % | Keep insufficient rules; show evidence count |
| Alert spam | Dedupe + thresholds + mute |
| Scope creep into SaaS | Schema-ready only; no auth in this epic |
| Flip positioning creep | Copy review: collector / trade-up language only |

## 13. Open questions (defaults if unanswered)

1. Alert delivery v1 = **in-app feed + optional email** — default in-app only first.  
2. Sold comps = **on-watch array** vs side file — default on-watch for locality.  
3. Trade-up exit condition default = **pre-owned** for owned watches.  
4. Price-drop alert threshold default = **5%**.  

## 14. Out of scope checklist

- [ ] Rename to Vitrine / new icon  
- [ ] Auth, Stripe, multi-tenant  
- [ ] Bulk marketplace crawler  
- [ ] Mobile `/value` redesign (separate P1 UI)  
- [ ] Curriculum / academy content  

## 15. Acceptance (epic done when)

- [ ] Detail Market section live with asks, fair band or insufficient, solds if present  
- [ ] Listing drop trail for at least one refreshed URL  
- [ ] Alerts for target_met and price_drop work in dogfood  
- [ ] Trade-up panel shows exit vs candidate with labeled assumptions  
- [ ] Tests cover insufficient evidence and no headline-as-second-source regression  
- [ ] README or docs snippet: how to add a dated link / sold comp / alert prefs  

