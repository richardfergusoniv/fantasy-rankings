# Fantasy Rankings design (frontend)

`frontend/src/theme.css` is the source of truth. Token values live in its `:root` block and are guarded by `frontend/src/theme-contrast.test.ts`; this file records intent and does not repeat values that change.

## Theme

- Dark only (`color-scheme: dark`). There is no light theme and no `prefers-color-scheme` handling.
- Amber is the interactive color: `--action`, `--link`, `--ring`, primary buttons and tab indicators. Dark ink (`--on-accent`) sits on amber fills.
- `--winner` is the amber highlight for the better side of a comparison or trade; `--warning` is a separate orange-red used only for cautions and always paired with a ⚠ glyph, so a caution never reads as an action.
- "Mine" (roster rows, the user's team in charts) uses its own teal, `--roster-highlight`, never the action amber.
- Surfaces step `--background` → `--card` → `--secondary`. Structure comes from flat rows and hairline dividers rather than boxes and shadows.
- Soft/tough matchup quality uses `--stat-strength-soft` / `--stat-weakness-soft` tints (see `sos-soft` / `sos-tough`).

## Type

Fira Sans for UI, Fira Code for data. Tokens: `--type-caption` 12px, `--type-body` 15px, `--type-section` 18px, `--type-display` 24px (30px at min-width: 760px). Numerals are tabular everywhere.

## Shape and spacing

- `--radius` is 12px; `sm`/`md`/`xl` derive from it. Small tags use 4px.
- 4px spacing steps. Touch targets default to 44px.
- One primary layout breakpoint at 760px, with additional responsive rules at max-width 420px and max-width 759px.

## Rules

- No raw hex colors in `theme.css` outside `:root` (enforced by the token-hygiene test).
- Don't encode meaning in hue alone; pair color with a glyph or label.

## History

`app/DESIGN.md` documents the legacy Hatch app. It does not describe this frontend.
