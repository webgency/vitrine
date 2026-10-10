# Vitrine implementation briefs

Paste **one brief at a time** into Cursor / Claude / ChatGPT. Do not merge multiple phases in one agent run unless the brief says they may parallelize.

## How to use

1. Open this repo (`webgency/watch-researcher`).
2. Give the agent: the brief file + permission to read linked docs (`docs/prd-p1-market-intel-trade-up.md`, `docs/branding.md`, `docs/competitive-lug2lug.md`).
3. Require a PR to `main` with the suggested title.
4. Merge, dogfood, then start the next brief.

## Sequence

| Order | File | Outcome |
|------:|------|---------|
| 0 | [00-working-agreements.md](./00-working-agreements.md) | Constraints every agent must follow |
| 1 | [01-p0-ui-polish.md](./01-p0-ui-polish.md) | Priority popover dismiss, quieter cards, ordinals |
| 2 | [02-detail-museum-layout.md](./02-detail-museum-layout.md) | Lug-inspired detail IA + key-spec strip |
| 3 | [03-chrome-nav-filters.md](./03-chrome-nav-filters.md) | Pill nav + filter toolbar rows + stat strip |
| 4 | [04-p1a-market-panel.md](./04-p1a-market-panel.md) | Market chapter + sold comps (P1a) |
| 5 | [05-p1b-listing-drops.md](./05-p1b-listing-drops.md) | Listing price-drop trail (P1b) |
| 6 | [06-p1c-alerts.md](./06-p1c-alerts.md) | In-app alerts (P1c) |
| 7 | [07-p1d-trade-up.md](./07-p1d-trade-up.md) | Trade-up panel (P1d) |
| 8 | [08-demote-wishlist-tiers.md](./08-demote-wishlist-tiers.md) | Value-first views; tiers → shortlist / watching / pass |
| 9 | [09-scrape-spec-coverage.md](./09-scrape-spec-coverage.md) | Multilingual spec scrape, thin Shopify body fallback, coverage note |
| 10 | [10-qualityflags-missing-neutral.md](./10-qualityflags-missing-neutral.md) | Omitted quality flags stay neutral; review-leak fix; low-evidence hint |
| 11 | [11-selling-first-slice.md](./11-selling-first-slice.md) | Private seller data, For-sale page, mark sold with net proceeds |

## Related docs (not briefs)

- [../prd-p1-market-intel-trade-up.md](../prd-p1-market-intel-trade-up.md) — full P1 PRD
- [../competitive-lug2lug.md](../competitive-lug2lug.md) — Lug²Lug competitive notes
- [../ux-visual-opportunities.md](../ux-visual-opportunities.md) — visual/UX opportunity list
- [../branding.md](../branding.md) — Vitrine identity (Manrope, cocoa/azalea)
- [../roadmap-ux-and-p1.md](../roadmap-ux-and-p1.md) — sequencing rationale

## Product north star

**Lug²Lug helps you discover and log the box. Vitrine helps you decide the next move.**

Do not build a 15k-watch catalog, wear streaks, or flip-school ROI tools in these briefs.
