# 11 — Selling, first slice: private data, For-sale page, mark sold

**PR title:** `feat: for-sale listings, private seller data, mark sold`
**Depends on:** 07 (trade-up panel; its exit range is the pricing input)
**Refs:** `docs/briefs/00-working-agreements.md`; `src/lib/trade-up.ts`, `src/lib/valuation.ts`, `src/lib/sold-comps.ts`, `src/lib/store.ts`, `scripts/build-static.mjs`, `scripts/prepare-pages.mjs`

May split into two PRs: **A** (private store + purchase prices + export guard) first, then **B** (listing, For-sale page, mark sold). A is useful by itself and B depends on it.

## Context and decisions already made

- Volume is low: one to three watches a year. Build the smallest flow that sells one watch well. No offer tracking, CRM or bulk tools.
- Channels: a public For-sale page on the Pages site with contact info and a payment link (PayPal or similar), plus marketplace postings recorded by hand.
- The app runs on the owner's laptop. It's reached from anywhere over Tailscale (local editable mode, unchanged). The Pages site stays public and read-only.
- **The repo is public, and the static export ships page data to the browser.** Anything in `data/watches.json` is published twice: in git and on Pages. Seller-private data therefore lives in a **git-ignored `data/private.json`**, read only by the local server.
- Later (not now): selling for friends (consignment), possibly other users. Shape the data so that's an extension rather than a rewrite (see *Future-proofing*), but build none of it.

## Rules

These carry over from how the engine already works. Treat them like the scoring invariants in CLAUDE.md.

1. **Your own ask is never market evidence.** The listing lives outside `watch.links`, and so do marketplace postings of your listing. `marketValueSummary()` and the trade-up exit must give identical output before and after a listing is added. Test this.
2. **An ask is not a sale.** Only a closed sale becomes a `SoldComp`.
3. **Proceeds are net and show their inputs.** A missing fee or shipping cost is *unknown*, and net proceeds then show as unknown, never as the gross price. Same rule as "missing data is never a zero".
4. **For sale is a layer on `owned`, not a status.** The watch stays `owned` (in the collection, in trade-up) until it is marked sold.
5. **Drafts never leave the machine.** A `draft` listing isn't hidden on Pages: it isn't in the export at all.
6. **Private data never reaches the export**, even when a local `build:static` runs on a machine that has `private.json`.

## Data model

### Public, in `watches.json` (`Watch.listing?`)

```ts
type ListingState = "draft" | "live" | "reserved";

interface SaleListing {
  state: ListingState;
  askingPrice: Money;
  grade: ConditionGrade;          // see scale below
  conditionNotes?: string;        // scratches, polish, service — free text
  included: ListingInclusion[];   // box, papers, extra links, straps…
  serviceHistory?: string;        // public summary only; receipts stay private
  photos: string[];               // own photos only; see photo storage below
  description?: string;           // listing text
  postings?: ListingPosting[];    // where else it is listed
  listedAt?: string;              // set when state first becomes "live"
}

interface ListingPosting { platform: string; url?: string; askingPrice?: Money; postedAt: string }
```

- **Condition scale.** Declare it once, like `specs.ts`, with a one-line definition per grade: `unworn | excellent | very-good | good | fair`. It's separate from the existing `Condition` (`new | pre-owned`), which describes market evidence. An own sale maps to `pre-owned` when it becomes a comp, unless the grade is `unworn`. If so, ask before deciding, and don't guess.
- **Photos must be your own.** A shop or marketing image (`imageUrl`) must not be used as a listing photo, and the UI says so. A `live` listing needs at least one photo, and validation enforces that.
- **Photo storage follows rule 5.** While a listing is a `draft`, its photos live in git-ignored `data/listing-drafts/<id>/`. Going `live` moves them to `public/listings/<id>/` (committed and published). Going back to `draft` doesn't unpublish anything already pushed, so the editor says that.
- A listing's *postings* are records of your own listing. They are not `RetailerLink`s and never enter valuation, alerts or price history.

### Seller contact, public (`data/seller.json`)

One record: display name, email, an optional payment link (e.g. a PayPal.me URL), and a short terms note (payment method, shipping region, returns). Shown on the For-sale page. **Payment is a link only. No PayPal API, no checkout, no Stripe** (00 forbids it). Suggest buyers pay with PayPal Goods & Services in the terms copy; don't build it.

### Private, in `data/private.json` (git-ignored)

Keyed by watch id:

```ts
interface PrivateWatchRecord {
  purchase?: { price?: Money; date?: string; source?: string };
  minimumPrice?: Money;      // floor you'd accept; never displayed on Pages
  serial?: string;
  saleClose?: {              // filled by "mark sold"
    buyer?: string;
    fees: FeeLine[];         // channel fee, PayPal fee, commission… may be empty
    shipping?: Money;        // undefined = unknown, not zero
    notes?: string;
  };
}
interface FeeLine { label: string; amount?: Money }  // amount undefined = unknown
```

- `Watch.purchase` moves here. Today no watch records one, so there's no migration. Remove `purchase` from the public schema, or have `validate:data` fail if `watches.json` contains a purchase price, so it can't creep back.
- What stays public on `Watch.sale`: `price`, `date` and `channel`. Fee and shipping detail stays private. *(Open question 1: whether the sale price itself is public.)*
- Write `private.json` via the same atomic tmp+rename as `store.ts`. A missing file means empty, not an error. Add it to `.gitignore` in PR A, **before** any code writes it.
- Back it up: this file is only on the laptop. The edit form says so in one quiet line. No backup feature.

## Implement

### A. Private store and export guard (PR A)

- `src/lib/private-store.ts`: server-only read/write of `private.json`. It must not be importable from client components (use `import "server-only"` or the repo's equivalent).
- Merge private data into what pages see **only when `!IS_STATIC`**.
- **Export guard, three layers** (rule 6):
  1. `scripts/build-static.mjs`: add `data/private.json` to the copy exclusions.
  2. `scripts/prepare-pages.mjs`: delete it from the temp checkout if present.
  3. A post-export check: scan `out/` for private keys and private values (if the file exists locally). It also checks that no `draft` listing appears. Any hit fails `build:static`.
- Purchase fields in the owned watch's edit form (price, date, source) and in the trade-up panel. Show gain/loss against the exit range only locally, labelled with its inputs.
- Then the owner records purchase prices for the three owned watches. That's data entry, not code: leave a field blank when the value isn't known.

### B. Listing and For-sale page (PR B)

- **Sell-or-keep card** on owned detail, local only. It shows: what you paid, the exit range (existing), own-model comps (existing `soldComps`), brand liquidity chip (existing friction), the minimum, and net at the asking price under each fee line entered. Suggest an asking price only from the exit range. When the exit evidence is insufficient there's no suggestion, using the same two-source gate.
- **Listing editor**: state, ask, grade, inclusions, notes, photos (reuse `ImageDropzone` if it fits; storage as above), description, postings.
- **Draft listing text** from spec fields (`specs.ts`) plus grade and inclusions, inserted into `description` for editing. This is plain templating, no LLM call. It never states a spec the watch record doesn't have, following the scraper's extraction-never-invents rule.
- **Public page `/for-sale`**: `live` and `reserved` listings with photos, ask, grade, inclusions, description and seller contact. `reserved` shows "Reserved" and no contact call to action. With no live listings, the page shows an empty state rather than a 404. Add a nav entry only when at least one listing is live.
- On a watch's public detail page, a live listing shows a "For sale" card linking to `/for-sale`.

### C. Mark sold (PR B)

- An action on a listed or owned watch asks for:
  - sale price, date and channel
  - fee lines (each optional = unknown)
  - shipping (optional = unknown)
  - buyer (optional, private)
- On save:
  1. `status: "sold"`, `sale: { price, date, channel }`.
  2. Remove the listing, or freeze it. Pick one and document it: the For-sale page must drop it either way.
  3. Write `saleClose` to the private store.
  4. Append a `SoldComp` to the watch's own `soldComps`: price, condition, `soldAt`, and a `source` like `"Own sale — Chrono24"`. It's real evidence of what the model sells for. `SoldComp` still never feeds the deal score.
- Result view (local): gross, each fee line, shipping, net, and gain/loss vs purchase, with unknowns shown as unknown (rule 3).
- Marking sold fires no alert. Check `detectAlerts()` doesn't treat the status change or the new comp as an offer event.

## Future-proofing (schema-ready only, nothing built)

- `FeeLine` is a labelled list rather than fixed fields, so a consignment commission is just another line.
- Key private records by watch id, and keep `seller.json` a single object rather than scattered settings, so either can later be keyed per owner or consignor.
- One comment on `SaleListing` noting that consignment would add an owner/consignor reference. **No** `consignor` field, auth, accounts or multi-user code in this brief.

## Out of scope

- Offer/inquiry log
- Contact forms (Pages can't receive them; email link only)
- Payment or shipping integration
- Auto-posting to marketplaces
- Listing-fee calculators per platform
- Consignment
- Multi-user

## Done when

- [ ] `data/private.json` is git-ignored, and a test shows the store treats a missing file as empty.
- [ ] Local `npm run build:static` with a populated `private.json` and a `draft` listing produces an `out/` containing neither, and the guard fails the build if either is planted.
- [ ] Adding a listing (with postings) leaves `marketValueSummary()` and the trade-up exit byte-identical. This is a unit test.
- [ ] A `live` listing needs ≥1 own photo, and `validate:data` covers listing shape and the no-public-purchase rule.
- [ ] `/for-sale` renders live and reserved listings and an empty state, in both local and static mode.
- [ ] Mark sold with one fee unknown shows net as unknown. With all fees known, it shows the exact net and gain/loss.
- [ ] Mark sold appends exactly one `SoldComp` and fires no alert.
- [ ] `npm run check` and `npm test` pass.

## Open questions for the owner

1. **Is your sale price public?** As a public comp it's honest market evidence, and marketplace sale prices are often public anyway. As a private one it's hidden from the comp list on Pages. Default: public price and date, private fees and buyer.
2. **Condition scale wording.** The five grades above are the default. Change them before PR B if you prefer another scale.
