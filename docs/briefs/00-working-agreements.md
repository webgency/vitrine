# 00 — Working agreements (read first)

**Repo:** `webgency/vitrine` (renamed from `watch-researcher`; GitHub redirects the old URL)  
**Product name in UI:** Vitrine; GitHub Pages base is `/vitrine`

## Always

- Follow `docs/branding.md` (Manrope, cocoa/azalea). Do not reintroduce slate-only chrome or emoji logos.
- Never invent prices, sold comps, or provenance.
- Deal / market rules stay honest: ≥2 independent **dated** retailer sources for fair bands; headline `price` is **not** a second observation (`src/lib/valuation.ts`).
- Overlap / similar-dial notes are FYI only — never change wishlist tiers or scores.
- Wishlist / shortlist labels are personal priority only; they never feed scoring.
- Value views hide tier chips; collection may show simplified `watching` | `shortlist` | `pass`.
- Scrape / autofill must not invent specs: prefer an incomplete result with a coverage note over guessed numbers.
- Multilingual product pages (DE / FR / ES / IT / EN) are in scope for spec extraction.
- Quality flags are tri-state; **omitted ≠ false**. Rubric must not punish incomplete autofill.
- Prefer small PRs; match existing Tailwind / `.card` / `.btn-*` / `.input` patterns in `src/app/globals.css`.
- Preserve static GitHub Pages mode (`IS_STATIC`) and local editable mode.

## Never in these phases

- Auth / Stripe / multi-tenant SaaS (schema-ready comments OK only where a brief says so)
- Bulk Chrono24/eBay crawlers
- Click-to-buy / messaging dealers as the user
- Flip / “wealth transfer” copy

## Agent output

- PR with clear title/body
- Note files touched
- Call out any brief ambiguity instead of inventing product behavior
