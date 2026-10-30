# Fantasy Rankings design (frontend)

`frontend/src/theme.css` is the entry point and `frontend/src/theme/*.css` is the source of truth. `theme.css` holds only `@import`s; the files are one cascade in a fixed order (`base`, `shell`, `tools`, `ask`, `matchup`, `players`, `command-bar`, `trade`, `comparison`, `analytics`, `power`, `feed`, `draft`, `responsive`, `overrides`), so add a rule to the file for its view and put it in `overrides.css` only if it must win. Token values live in the `:root` block of `theme/base.css` and are guarded by `frontend/src/theme-contrast.test.ts`; this file records intent and does not repeat values that change.

## Theme

- Light and dark follow the device by default (`color-scheme: light dark`). The sun/moon button beside refresh cycles device, light, dark; a saved choice sets `data-theme` on `<html>`, which `base.css` maps to a single `color-scheme`, and a small script in `index.html` applies it before first paint (`frontend/src/theme-preference.ts`). Every color token in `:root` is written `light-dark(<light>, <dark>)`, so there is one token block and components never branch on theme. Amber fills (`--action`, `--accent`, `--winner-fill`) and `--on-accent` ink are the same in both themes; amber *text* (`--link`, `--winner`) and teal/warning text switch to darker values in light so they stay at 4.5:1 on white. The contrast test checks the light palette too. Colors that live outside CSS (chart strokes) use tokens such as `--chart-1`, never raw hex.
- Amber is the interactive color: `--action`, `--link`, `--ring`, primary buttons and tab indicators. Dark ink (`--on-accent`) sits on amber fills.
- `--winner` is the amber highlight for the better side of a comparison or trade; `--warning` is a separate orange-red used only for cautions, so a caution never reads as an action. Outside injury badges a caution carries a line warning icon (never an emoji or a text glyph); injury badges are text and color only.
- "Mine" (roster rows, the user's team in charts) uses its own teal, `--roster-highlight`, never the action amber.
- Surfaces step `--background` → `--card` → `--secondary`. Structure comes from flat rows and hairline dividers rather than boxes and shadows.
- Soft/tough matchup quality uses `--stat-strength-soft` / `--stat-weakness-soft` tints (see `sos-soft` / `sos-tough`).

## Type

Fira Sans for UI, Fira Code for data. Tokens: `--type-caption` 12px, `--type-body` 15px, `--type-section` 18px, `--type-display` 24px (30px at min-width: 760px). Numerals are tabular everywhere.

## Badges

Three jobs, three looks (`theme/badges.css`). One meaning per color.

- Every badge, tag and chip, in all three families below, is one height (`--badge-height`, 20px) so they line up side by side in a row.
- **Link badges** open something: amber outline pill, 44px tap area, no arrow or chevron. A matchup link shows only the matchup ("KC vs LV"), with green (`--stat-strength-*`) for easy or red (`--stat-weakness-*`) for tough; the quality is in the aria-label. A neutral matchup is the plain amber link.
- **Status badges** say what state something is in: filled, never tappable. Warnings are coral (`--warning`, `--warning-bg`) pills; injury badges carry no icon.
- **Descriptor tags** describe a player, team or slot: hairline outline, no chevron.
- Selected tabs are gray (`--segment-selected`) with normal text; amber is for links and your side's edge.
- No emoji anywhere in the app; icons are lucide line icons or drawn shapes.

## Shape and spacing

- Header tabs switch between different pages or views (Players: Rankings, Waivers, Comparison; Draft: Board, My team). An in-page control changes how the same view is shown or filtered: Matchup's Current / Optimized lineup, and the compact filters below.
- Compact filters (`SegmentedControl` with `compact-control`: 32px, content width, centered, `--radius-sm`) sit under the tabs for two-option choices such as Rankings horizon, Trade basis and Comparison window. Four or more options use a pill select.
- Text on tappable controls (buttons, selects, links, chip lists) uses `--type-control` (14px, same as tabs). The 12px `--type-caption` is for metadata, column heads and field labels, not for something you tap. The exception is link badges, which stay 12px so a long label such as "Game lines · Sun, Oct 26, 1:00 PM PT" fits on a phone.
- `--radius` is 12px; `sm`/`md`/`xl` derive from it. Small tags, chips and skeleton lines use `--radius-xs` (4px, derived from `--radius`); never write a bare `4px` radius. Flat list rows, dividers and full-bleed frames use `0` on purpose.
- 4px spacing steps. Touch targets default to 44px.
- One primary layout breakpoint at 760px, with additional responsive rules at max-width 420px and max-width 759px.
- On desktop, the page tabs, sub-tabs and every view share one content width (`--content-width`), so they end at the same right edge.

## Tools

- Each Tools view (Game lines, Team stats, Analytics) opens with one toolbar of pill controls (`.monitor-value-chart-field`: caption and value inside one 44px control) that wraps on a phone. The sub-tab names the view, so the view's own heading is screen-reader only.
- Team stats opens on a line chart by week; the "Week-by-week table" button (or the chart) opens the usage grid (players by weeks): each player's season Share of the group total (count stats; snaps show snap % instead), then the weeks and Avg. Cells tint on one blue scale (`--chart-5`, capped so text stays readable): by snap % for snaps, otherwise by share of that week's group total, scaled to the largest share in the grid.
- Summary before detail: Game lines opens with the week's slate and the picked game's board, then a "Player props" section with its own filters (the one Tools view whose toolbar is not first). A player's market value, its 30-day move and its value trend live on the player card. Charts and tables sit on one `--card` surface panel each.

## Shared pieces

- Page summaries: Matchup, Power and Projected open with one raised `Card` (hairline, `shadow-sm`). Other panels stay flat; only modals get real depth.
- Icons are lucide line icons from `components/glyphs.tsx` (close, back, chevron, plus, sort). Movement is the drawn `MoveTriangle` (rank, value, depth chart, ticker); never a typed ▲ ▼ × ← ›.
- States come from `components/state-blocks.tsx`: `LoadingBlock` (caption over shimmer rows), `EmptyState` (what is missing, then what to do) and `ListPagination` ("120 of 348 · Show 120 more").
- Eyebrow labels and column heads are sentence case, 12px, weight 600. The font ships 400, 500, 600, 700 and 800; use 600 for labels and 700 for values.
- A status badge (`.status-badge`) names a state such as a bye week, kickoff time or playoff status; injury and designation tags use the same class.

## Rules

- No raw hex colors in `theme/*.css` outside `:root` (enforced by the token-hygiene test).
- Matchup quality (soft or tough) is carried by color alone, with no arrow; the soft/tough wording stays in the aria-label. Elsewhere, don't encode meaning in hue alone: pair color with a glyph or label.

## History

`docs/DESIGN.md` documents the legacy Hatch app. It does not describe this frontend.
