# UI

Page, chart and styling rules for the viewer. Keep this file current when a rule here changes in code.

## Pages

- Every element answers a driver question for its page, and every summary card opens the tab or page with the full story.
- `SessionPage` picks the view by `sessionKind()` (`src/pages/session/`: `RaceView`, `LongRunView`, `QualifyingView`, `TimeTrialView`).
- Each session page leads with a hero headline. A new insight goes into the ranked Worth a look list (`src/analysis/worthALook.ts`), never a new tile or card. Worth a look takes every item that clears its threshold in the Tuning section; `WorthList` shows five and folds the rest behind "Show N more". `rankWorthItems()` ranks places before seconds. The list carries no padding or placeholder items, never repeats the headline, and takes imperative advice only from lap-telemetry tips.
- Position changes come from `buildRaceStory()`: a pit cycle nets out once nearby cars have made their matching stop, and a swap that comes back within two laps reads as steady, so chips and headlines never credit a pit cycle or a back-and-forth as places gained.
- Race pages show no whole-race sector split: it is not actionable. Qualifying keeps its one-lap sector cards.
- The track Setups tab shows the quali setup (fastest or latest), the race setup and every setup run there; `setupIdentity()` ignores brake bias and fuel, which drivers change mid-session.
- `/ui-debug` is a dev-only page of UI fixtures (`src/pages/UiDebugPage.tsx`).
- `src/components/ui/pageTabs.ts` owns the sticky tab bar shared by session and track pages and its tab-switch scroll. A sticky element or scroll target inside a tab panel takes its offset from there so it clears the stuck bar.

## Charts

- Anything per lap is drawn by `LapChart`: a line on a normal time axis (quicker laps lower, pit and SC laps in an "off scale" gutter above), the compound strip beneath, SC/VSC as grey washes, pit hairlines, and the driver's own events lane. A faded dot is a lap Race Pace leaves out (`buildDriverLapSeries()`), a flat line a stint average. Stacked panels (position over lap time) are labelled and spaced apart.
- Dates are progress lines (`TrendChart`), drivers are sorted bars, places on track use the circuit map; no donuts.
- A single driver's line is neutral ink. With a comparison driver or stint on the chart, you are `--color-chart-you` (cyan) and they are `--color-chart-compare` (orange), drawn lighter and thinner as a reference beside your line; Lap telemetry's A and B use the same pair. Purple is the fastest.
- Circuit maps are `TrackOutline`, drawn from `trackGeometry.ts` in the brand red. `detail` adds the chequered timing line, sector splits (lap fractions from `session-info` `sector-2/3-lap-distance-start`, which older exports leave at 0) and turn numbers, each label on the side of the track with the most room.
- Chart tooltips and ticks come from `charts/chartStyles.ts`.

## Colour

- Light and dark themes: `index.html` sets `data-theme` before first paint (`?theme=light|dark`, else the system setting) and `src/index.css` overrides tokens for light.
- Neutrals use the theme-aware `tone-*` scale (`bg-tone-900`, `text-tone-500`, `ring-tone-0/[0.06]`); `zinc-*`, `white` and `black` stay fixed in light mode. Inline and SVG colours use `var(--color-tone-*)`. For a translucent dynamic colour use `color-mix(in oklab, <color> N%, transparent)`, since compound and chart colours can be CSS variables and break hex-alpha suffixes.
- Accent text in 200–400 shades is remapped to darker shades in light mode; meaning-bearing colour goes through `best`/`ahead`/`behind`/`warning`/`active` and `CHART_THEME`.
- Colour carries meaning (semantic tokens in `src/index.css`): purple (`best`, the `purple` accent) means fastest or session best, as in F1 broadcasts; green and red (`ahead`, `behind`) mean gaining or losing against a rival or a previous result.
- `brand` is the logo's red (`AppLogo`, track maps, the What's new dot). It never carries data, so a loss is always `behind`.
- In a tile that mixes prose with a number, tint only the number (`Slower by <span className="text-behind">+0.583</span>`); verbs, labels and units stay neutral. A tile showing one bare value keeps its full colour.

## Surfaces and components

- Every surface and recurring recipe has one source of truth; compose it with `cn()` and override only layout (padding, radius, width, position). A surface that needs a different fill, ring or shadow gets a new recipe in its source rather than an inline copy.
  - Cards, tiles, wells, menus, dialogs and the hero card: `src/components/ui/surfaces.ts`.
  - A page opens with `PageHeader` (and its `Breadcrumb`); a titled card is `Panel`; headers are `SectionHeader` (`lg` a page section spanning several cards, `md` one card's title inside or directly above it, `sm` a subsection).
  - Tables use `ui/table.ts` (`inset` cells when rows can be highlighted, `flush` otherwise, `edge` for a table filling an unpadded card); page width is `ui/page.ts`.
- Variants go through `cva` composed with `cn()`. Menu and list rows take their state from attributes, not extra classes: `menuItemClass` for rows Base UI or the ⌘K palette highlight (`data-highlighted`), `listItemClass` for plain link or button rows. `aria-current="page"` tints the row for the current page `active`, and `data-selected`, `data-checked` or `aria-pressed` marks a picked row. The current driver's table row is `tableRowFocusedClass`, also `active`.
- Interactive widgets are Base UI (`@base-ui/react`; its docs ship in `node_modules/@base-ui/react/docs`), wrapped in `src/components/ui/` (`Menu`, `NavigationMenu` for top-bar panels, `Dialog`, `Modal`, `PillSelect`, `MultiPillSelect`, `SegmentedControl`, `FocusToggle`) plus `src/components/Tooltip.tsx`. A new menu, popup, dialog, select or toggle builds on them, so focus, keyboard, outside click and exit animation come from Base UI rather than hand-written handlers. Popups open and close with `popMotionClass` (backdrops `fadeMotionClass`), a transition on Base UI's starting/ending attributes from `--transform-origin`.
- Anything labelled as qualifying, race, long run or time trial (tabs, filters, stat labels, panel headers, table cells) carries that kind's glyph through `SessionKindIcon`: Timer for quali, Flag for race and long run, Gauge for time trial (`src/components/sessionTypeMeta.ts`). The glyph stays neutral, never the kind's colour, and those three icons mean nothing else in labels or stat cards. Every session and track page tab renders through `PageTab` with its glyph from `PAGE_TAB_ICONS` (`src/components/ui/pageTabs.ts`).
