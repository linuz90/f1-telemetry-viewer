import type { CSSProperties } from "react";
import { ACCENT_TOKENS, type AccentColor } from "../constants/accents";
import { cn } from "../utils/cn";

/**
 * Base card styles shared across the app.
 *
 * Style language: soft elevated surfaces on a dark canvas — no hard 1px borders.
 * Cards lift off the background with a subtle translucent fill and large radii.
 * A 1px inset highlight along the top edge mimics light catching the surface
 * from above — it's the only "border" cards get, and it's there to bump contrast
 * without re-introducing the boxed-in look.
 * Use `cardClassFeature` for highlighted/headline tiles (gentle gradient accent).
 */

/** 1px inset highlight along the top edge. Export so ad-hoc card-like surfaces
 *  (gradient heroes, list-row links, empty states) can opt in for visual parity
 *  with shared `cardClass*` variants. Skip on accented/colored tiles — they
 *  already carry their own ring of the appropriate hue. */
export const cardHighlight = "shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]";

export const cardClass = `rounded-2xl bg-zinc-900/70 p-5 ${cardHighlight}`;
export const cardClassCompact = `rounded-2xl bg-zinc-900/70 p-4 ${cardHighlight}`;
export const cardClassFeature = `rounded-2xl bg-gradient-to-br from-zinc-800/90 via-zinc-900/80 to-zinc-900/50 p-5 ${cardHighlight}`;

/**
 * Accent card recipe — the single source of truth for any nested card surface
 * tinted by an accent color (podium chips, insight cards, compound stints,
 * "best lap" highlights, etc.). The visual is:
 *   • 3-stop linear gradient from top-left: accent @ 12% → zinc-900 @ 60% → zinc-900 @ 40%
 *   • 1px inset ring of the accent @ 25%
 *
 * Static accents go through `ACCENT_TOKENS` / `accentCardClass()`. Dynamic
 * runtime colors (tyre compound hexes) go through `dynamicAccentCardStyle()`,
 * which produces the same recipe via inline style.
 */
/** Full className for an accent-tinted surface. Includes the top-lit border +
 *  gradient, but NOT the radius/padding (caller picks `rounded-{lg,xl,2xl}`
 *  and spacing). */
export function accentCardClass(accent: AccentColor): string {
  const t = ACCENT_TOKENS[accent];
  return `${t.topLit} ${t.bg}`;
}

/** Neutral counterpart to `accentCardClass` — same 3-stop gradient shape (lit
 *  from the top-left, fading into the parent surface) and the same inset ring,
 *  but in a quiet white key. Use for nested cards that don't carry semantic
 *  color (e.g. non-best sector cards in Sectors-vs-Best). Pairs visually with
 *  the accent variant so a row of mixed cards reads as one family. */
export const neutralCardClass =
  "ring-1 ring-inset ring-white/[0.06] bg-gradient-to-br from-zinc-800/40 via-zinc-900/40 to-zinc-900/20";

/** Same recipe as `accentCardClass`, expressed as inline CSS, for cases where
 *  the accent color is runtime-dynamic (e.g. tyre-compound hexes). Hex suffixes:
 *    1f ≈ 0.12 alpha (matches Tailwind `/[0.12]` gradient stop)
 *    47 ≈ 0.26 alpha — top edge bright highlight
 *    0f ≈ 0.06 alpha — bottom + side dim edges
 *  Keep the four-stop shadow alphas in sync with `ACCENT_TOKENS.*.topLit` so
 *  static and dynamic accent cards read at the same weight side-by-side.
 *  zinc-900 surface = rgb(24 24 27). */
export function dynamicAccentCardStyle(hex: string): CSSProperties {
  return {
    background: `linear-gradient(to bottom right, ${hex}1f 0%, rgba(24, 24, 27, 0.6) 50%, rgba(24, 24, 27, 0.4) 100%)`,
    boxShadow: [
      `inset 0 1px 0 0 ${hex}47`,
      `inset 0 -1px 0 0 ${hex}0f`,
      `inset 1px 0 0 0 ${hex}0f`,
      `inset -1px 0 0 0 ${hex}0f`,
    ].join(", "),
  };
}

/**
 * Card — a simple container with the app's standard soft dark surface.
 * Accepts all props that a `<div>` does; pass `as="section"` for semantic sections.
 */
export function Card({
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" }) {
  return (
    <Tag className={cn(cardClass, className)} {...rest}>
      {children}
    </Tag>
  );
}
