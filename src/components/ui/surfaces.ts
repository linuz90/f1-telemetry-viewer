import type { CSSProperties } from "react";

/**
 * Surface recipes: the one source of truth for cards, tiles, menus, dialogs and
 * chart tooltips. Compose them with `cn()` and override only layout (padding,
 * radius, width, position). A surface that needs a different fill, ring or
 * shadow gets a new recipe here, never an inline copy.
 */

/** A top-level card on the page canvas. Smaller list cards override the
 *  radius: `cn(cardSurface, "rounded-xl")`. */
export const cardSurface = "rounded-2xl bg-tone-900 ring-1 ring-tone-800";

/** `cardSurface` with the standard padding. `Panel` renders it. */
export const cardClass = `${cardSurface} p-5`;

/** The hero card that opens a session or track page. */
export const heroCardClass = `${cardClass} relative sm:p-6`;

/** Added to a card that is itself a link or button. */
export const cardHoverClass =
  "cursor-pointer transition-shadow hover:ring-tone-700";

/** A tile raised inside a card: stat tiles, compact summaries, chips. */
export const insetTileClass = "rounded-xl bg-tone-800/40 ring-1 ring-tone-800";

/** A well recessed into a card, for readouts set into the surface. */
export const wellClass = "rounded-xl bg-tone-950/40 ring-1 ring-tone-0/[0.04]";

/** Anything floating above the page: menus, popovers, dialogs, chart
 *  tooltips. Callers pick radius and padding. The ring is a step lighter than
 *  a card's so a panel over a card still has an edge. */
export const floatingSurface =
  "bg-tone-900 ring-1 ring-tone-700 shadow-2xl shadow-tone-1000/40";

/** Open/close motion for every Base UI popup: a 140 ms fade and 97% scale
 *  from its anchor. Base UI sets `--transform-origin` and the starting/ending
 *  attributes; a transition (not a keyframe) lets a popup closed mid-open
 *  reverse smoothly. */
export const popMotionClass =
  "origin-(--transform-origin) transition-[opacity,scale] duration-140 ease-out data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:scale-97 data-ending-style:opacity-0 data-ending-style:ease-in";

/** The same timing as a plain fade, for backdrops. */
export const fadeMotionClass =
  "transition-opacity duration-140 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:ease-in";

/** A dropdown or hover menu panel. */
export const menuSurfaceClass = `rounded-xl p-1.5 ${floatingSurface}`;

/**
 * Row states come from attributes, not extra classes, so the markup that makes
 * a row accessible also styles it:
 * - `aria-current="page"`: the row for the page you are on, tinted `active`.
 * - picked: Base UI's `data-selected` / `data-checked`, or `aria-pressed` on a
 *   plain chooser button. The inset ring keeps it distinct from a lit row.
 * Only the column gap is set, so a two-line grid row keeps its own row gap.
 */
const rowClass =
  "flex w-full items-center gap-x-2 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors select-none data-disabled:pointer-events-none data-disabled:opacity-50 aria-[current=page]:bg-active/10 aria-[current=page]:text-tone-50 data-selected:text-tone-50 data-checked:text-tone-50 aria-pressed:bg-tone-800 aria-pressed:text-tone-100 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-tone-0/[0.08]";

/** A row whose highlight something else drives: Base UI menu and select items,
 *  and the ⌘K palette, which sets `data-highlighted` on its cursor row. It
 *  ignores `:hover`, so a resting pointer never leaves a second lit row when
 *  the keyboard moves the highlight. */
export const menuItemClass = `${rowClass} data-highlighted:bg-tone-800`;

/** A plain link or button row in a list nothing manages (top-bar panels, lap
 *  pickers): it lights on pointer hover and keyboard focus. */
export const listItemClass = `${rowClass} hover:bg-tone-800 focus-visible:bg-tone-800`;

/** 1px inset highlight along the top edge, for gradient surfaces that carry no
 *  ring (the demo banner). */
export const cardHighlight =
  "shadow-[inset_0_1px_0_var(--color-card-highlight)]";

/** A card tinted by a runtime colour (tyre compounds), as inline CSS because
 *  the colour is dynamic. Any CSS colour works, including the theme-aware
 *  `var(--color-compound-hard)`:
 *    12% — gradient stop
 *    28% — top edge bright highlight
 *    6% — bottom + side dim edges */
export function dynamicAccentCardStyle(color: string): CSSProperties {
  const tint = (pct: number) =>
    `color-mix(in oklab, ${color} ${pct}%, transparent)`;
  return {
    background: `linear-gradient(to bottom right, ${tint(12)} 0%, color-mix(in oklab, var(--color-tone-900) 60%, transparent) 50%, color-mix(in oklab, var(--color-tone-900) 40%, transparent) 100%)`,
    boxShadow: [
      `inset 0 1px 0 0 ${tint(28)}`,
      `inset 0 -1px 0 0 ${tint(6)}`,
      `inset 1px 0 0 0 ${tint(6)}`,
      `inset -1px 0 0 0 ${tint(6)}`,
    ].join(", "),
  };
}
