# Fantasy Rankings design

## Player cards (2026-09-24 cleanup)

Player cards no longer carry separate rank or 30-day movement badges. Rankings, search results, draft rows, matchup details, and power-ranking rosters keep the player-card structure and their existing primary values, matchup context, injury status, and source attribution. The detail sheet preserves 30-day movement as plain metadata rather than a badge, and the movement-threshold legend is removed with the badges. Matchup-line badges, including their loading placeholders, are removed from lineup rows; the fuller PFN team context remains available inside the player detail card.

## Table navigation (2026-09-24)

Every table-centric view exposes one compact native **Table** selector directly above its content. It switches among Player Rankings, Waiver Wire, League Power Rankings, and Strength of Schedule, so users do not have to traverse separate primary sections to move between tables. The selector preserves the existing primary and subview navigation, uses a full 44px touch target, follows the shared select-control styling, and remains 360px wide on larger screens rather than stretching across the dashboard.

## Charts

Both chart datasets in the Charts tool — Advanced Stats (`AnalyticsChart`) and Projections
(`WeeklyProjections` with `view="charts"`) — render through one shared `ScatterPlot`
component in `client/src/AnalyticsViews.tsx`. Premade presets, saved views, and custom axes
all use the same path, so formatting can only diverge via props. The shared chrome is also
unified: `ChartHeading`, `ChartKey`, and `OmittedChartLabels` replace the previously
duplicated heading/key/omitted-labels blocks.

- Single source of truth for formatting: margin `{ top 28, right 12, bottom 50, left 2 }`;
  `CartesianGrid` `var(--border)` dasharray `2 5`; ticks `var(--dim)` 10px, no tick lines,
  `axisLine` `var(--border)`; axis titles `var(--text)` 11px/800 (X `insideBottom` offset
  `-34`, Y `insideLeft` angle `-90`); tooltip cursor `var(--text)` dasharray `3 3`,
  surface/border 6px-radius 12px tooltip; reference lines `var(--text)` 1.2; field/smash
  scatters `var(--dim)` fillOpacity 0.72; my-team scatter `var(--roster-highlight)` with
  1.5px matching stroke; `AdaptiveChartLabels`; `ResponsiveContainer` height 430.
  Tabular numerals are global in theme.css.
- The only dataset-specific rendering difference is the axis-title suffix, passed as a
  prop: Advanced Stats appends `" / game"` (per-game averages); Projections uses no
  suffix (raw projection values).
- League-aware positions (mirrors rankings/waivers): each chart derives
  `validPositions = basePositionOrder.filter((p) => league.rankingPositions.includes(p))`
  — never hardcoded per league. The position `SegmentedControl` offers only valid
  positions (DEF still labeled DST). When the league changes and the current position is
  no longer valid, position resets to RB if valid else the first valid position, with
  that position's default x/y metrics and no selected saved view. `applySavedView`
  ignores saved views whose position is invalid for the current league, the
  `SavedViewControls` "My saved views" list filters to valid positions, and the
  Projections percentiles-view player search only matches valid positions.

## Search controls (2026-09-24 cleanup)

Player and asset searches are plain filter fields, never floating combobox menus. Rankings and Waiver Wire filter the main list in place. Trade, Advanced Stats, Projections, and Comparison render matching choices in normal document flow beneath the field, with an explicit empty state; choosing a result clears the query while preserving the chosen player in the surrounding view. Comparison slots stack on phones and split into two columns at the 760px breakpoint.

## Comparison tool

The third Tools subview is **Comparison**. It is a same-position, head-to-head player view.

- A league-aware position toggle is the first control, above the Advanced Stats / Projections dataset toggle. It shows only positions in `league.rankingPositions` and begins with no selection. Before a position is chosen, a centered empty state asks the user to select one.
- Choosing a position opens one centered selection card with PLAYER 1 / PLAYER 2 searchable slots. Both slots search only players at that position, remain editable, and prevent the same player from occupying both slots. Switching positions clears both picks. No new headshot source is introduced.
- A player sent from Waiver Wire Compare selects that player’s position, opens the selection card, seeds slot 1, and leaves slot 2 empty.
- Each comparison slot owns a strict 4px spacing scale instead of inheriting the 80px boxed-row system. Its 16px label row, 4px gap, and compact 44px player unit keep the name/position and matchup/time lines together; the inter-slot divider receives 12px on both sides. Inline search results use the same 44px two-line anatomy as the selected player and do not stretch either slot.
- The **Advanced Stats / Projections** dataset control remains. Advanced Stats retains **This season / Rolling 17 games**. Metric definitions, lower-is-better flags, peer sets, percentile calculations, and data sources remain unchanged.
- Each metric row has one 100% stacked bar. Segment widths use each player’s raw value as a share of the two-player raw total. When a proportional split is undefined because a value is missing, negative, or the total is zero, the visual falls back to an even split while leaving the source values visible. The existing positional-percentile winner logic still controls color: the winning segment is `--stat-strength` green. **Known issue (deferred under Richard's 2026-09-24 color freeze): the losing segment renders at the track color (effectively invisible) rather than the specified neutral grey; exact ties render neutral grey.**
- Raw values and ordinal percentiles remain visible above the bar, such as `13.6 · 82nd`. Missing values display an em dash without inventing a percentile.
- The tool keeps the existing source-specific empty states, 11/14/22 type scale, tabular numerals, hairline dividers, dark-mode tokens, sticky shell headers, and single 760px enhancement breakpoint. No bar-width transitions are defined in CSS (the previously documented 160ms transitions never landed — claim removed 2026-09-24).

## Strength of Schedule

The fourth Tools subview is **Strength of Schedule** — one monochrome table of all 32 NFL defenses.

- Rows: all 32 defenses, initially sorted alphabetically by team abbreviation. Columns: QB / RB / WR / TE. Cells show only the defensive rank numeral. The Team header restores alphabetical order; each position header sorts softest-first on its first tap, toggles to toughest-first on its second tap, and shows a quiet arrow only while active. Choosing a different position restarts at softest-first.
- Rank 1 = softest defense vs that position (most points allowed); rank 32 = toughest (fewest allowed). The explainer under the heading reads "1 = softest defense vs that position (most points allowed)." The legend identifies "Ranks 1–10 · soft" and "Ranks 23–32 · tough." Section heading also carries "through Week N" plus "early-season sample" when N ≤ 3.
- Broad matchup highlight (existing soft semantic tokens, no new colors, no blue): ranks 1–10 get `var(--stat-strength-soft)` cell background; ranks 23–32 get `var(--stat-weakness-soft)`; ranks 11–22 receive no treatment. Background tint only, with tabular figures. Mirrors the existing swapped-in/demoted highlight language.
- Sticky position header row + sticky team column; the five columns each own an explicit 20% of the table so TEAM / QB / RB / WR / TE fill the available content width evenly at phone and desktop sizes, without a mobile horizontal scroller; hairline dividers; dense rows; dark-mode tokens. No player rows, grades, pills, filters, or bye states.
- Footer carries "Strength of schedule through Week N".
- The same backgrounds form a global matchup-quality language for weekly matchup reference tags. Resolve each QB/RB/WR/TE tag from the selected league’s table using the opposing defense: ranks 1–10 use `--stat-strength-soft`, ranks 23–32 use `--stat-weakness-soft`, and 11–22 remain untinted. Apply the tag consistently in Rankings, Waiver Wire, Comparison player cards, player-detail headers, the Matchup view, Draft, Power Rankings, and weekly team cards. The highlight changes only the background. Bye weeks render a neutral `BYE` tag; K and DST tags stay untinted.
- Presentation-only: ranking and projection logic elsewhere is untouched.

## Draft (2026-09-24 cleanup)

Impeccable Operate-mode quiet pass. Board rows carry no colored stat text: the Val/Proj
verdict ("Value +12" / "Reach −9" / "Fair") renders as quiet dim 11px (`--dim`,
`--type-meta`) under the market-value number; the `draft-value` / `draft-reach` classes
are retired. Exactly one tappable blue exists on board rows — the circular `+` in accent
blue and adds the player directly to My Team in both mock and live modes. "Mark taken" is a quiet dim 11px
text link ("Taken") in mock mode only; `--roster-highlight` is retired from row buttons.

Board view order: live-draft status → team build → filters → board → source caption.
Team build is the board view's only subsection heading.

- The recommendation, queue/watchlist, recent-picks, and market-context sections are removed from the board. Queue/watchlist state and controls do not exist; the row `+` continues to add directly to My Team.
- Team build: boxed stat grid replaced by a plain hairline row
  (`draft-plain-row`, "QB 1 · RB 2 · …") under the existing h2 + needs caption.
- Market context collapsed into a `<details>` element (same pattern as
  "Drafted elsewhere").
- Source attribution ("Primary ADP: Fantasy Football Calculator · …") is a single
  11px dim caption (`draft-source-caption`) at the bottom of the board view, no bold. When the FFC fetch fails the caption states ADP is unavailable instead of naming FFC as primary, `· ADP as of {date}` is appended when the vintage is known, and any draft source errors render as a warning list above the board (2026-09-25 data-honesty fix).
- "Draft room" heading is 22px per the 11/14/22 type scale.
- The board header is a compact 28px key row with 11px uppercase labels; player rows are 46px with 15px names and values. Draft rows do not inherit the 80px two-band player-row rhythm used by fuller lineup and comparison surfaces.

Untouched: Draft Board + My Team tabs, Sleeper read-only behavior, all data columns
(Tier, ADP, Val/Proj), position filters and search, SoS MatchupTag tints, and player-card
modal. The Val/Proj verdict column stays visible.

### Trade and select-control polish (2026-09-24)

- In League-adjusted trade mode, the user's team is fixed from the selected league and is no longer presented as a selector. Only the trade partner is selectable.
- The trade-partner selector and chart Saved view selector use the same compact surface, hairline border, 8px radius, accent chevron, and focus ring language as the rest of the app.
- Calculate trade follows the two asset columns as the closing action for the workflow, with its readiness note directly beneath it.
- Draft Room uses title case and a restrained divider-backed page header; its refresh action sits on the existing subtle secondary surface.

### Row-toggle convention (2026-09-24)

Row-level add/toggle actions across the app share one treatment: `.row-toggle-state`
— a 26px round soft circle (`accent-soft` background, accent glyph; selected state is
`roster-highlight-soft` with a `✓`). It appears in trade picker rows and draft board
rows alike. Draft board uses the `+` circle to add directly to My Team in both mock and
live modes; mock mode also offers the quiet dim "Taken" text link. My Team "Remove" is
a bare accent text link.


## Matchup view (2026-09-24 minimalist pass)

The Matchup view uses a scoped Swiss-minimal treatment without changing the other primary views. Its current/optimized control is a flat two-tab rail; the score summary is an unboxed divider-led block; lineup sections use more vertical separation while retaining the compact Sleeper-style three-column rows, projections beside the center position, and 44px game-badge targets. Repeated current/optimized and “head to head” labels are removed because the control and two-sided grid already communicate them.

Matchup content uses Fira Sans at 11/13/15/20px and weights 400/500/700; numerals remain tabular. In the light theme, content is slate on `#F8FAFC`/white, blue is limited to interactive controls and badges, and the user's score is the one amber emphasis. Optimized substitutions retain their existing row treatment and add compact visible `IN` / `OUT` tags beside the player name: swapped-in players repeat the power-ranking roster treatment (`--roster-highlight-bg` with the player name in `--roster-highlight`), while demoted players use a muted neutral tint and dim name. The inset edge keeps its existing left/right direction for the two lineup columns, and assistive names announce each substitution state. Matchup rows and the score summary are flat with hairline section dividers; only the opened matchup data dialog carries a restrained shadow. The dialog keeps final scores and expands the pregame/live PFN preview into two fixed-order offense-vs-defense blocks, always leading with the team named first on the badge. Each block compares Grade, Scoring, Pass, Run, EPA/Play, Yds/Play, Success%, and Expl% with compact stacked bars whose proportions and winner state come from each side’s PFN rank; raw defensive efficiency stats use lower-is-better ranks. Compact SOS badges sit with each team, and final games continue to show only the box score.
