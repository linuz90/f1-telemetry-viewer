import type { CSSProperties } from "react";
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
export interface AccentToken {
  /**
   * Four-sided inset box-shadow — top edge ~5× brighter than the other three
   * so the card reads as lit from above. Stored as a LITERAL static string per
   * accent (not built at runtime) because Tailwind's JIT only picks up class
   * names it can see in source. Same recipe everywhere: top 0.26α, sides &
   * bottom 0.06α, using the accent's Tailwind-500 RGB triplet.
   */
  topLit: string;
  /** Tailwind background gradient. */
  bg: string;
  /** Text color for icons/eyebrows on the tile. */
  iconText: string;
  /** Strong accent text — often same as iconText. */
  accent: string;
}

export const ACCENT_TOKENS = {
  amber: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(245_158_11/0.26),inset_0_-1px_0_0_rgb(245_158_11/0.08),inset_1px_0_0_0_rgb(245_158_11/0.08),inset_-1px_0_0_0_rgb(245_158_11/0.08)]",
    bg: "bg-gradient-to-br from-amber-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-amber-300",
    accent: "text-amber-300",
  },
  rose: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(244_63_94/0.26),inset_0_-1px_0_0_rgb(244_63_94/0.08),inset_1px_0_0_0_rgb(244_63_94/0.08),inset_-1px_0_0_0_rgb(244_63_94/0.08)]",
    bg: "bg-gradient-to-br from-rose-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-rose-300",
    accent: "text-rose-300",
  },
  cyan: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(6_182_212/0.26),inset_0_-1px_0_0_rgb(6_182_212/0.08),inset_1px_0_0_0_rgb(6_182_212/0.08),inset_-1px_0_0_0_rgb(6_182_212/0.08)]",
    bg: "bg-gradient-to-br from-cyan-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-cyan-300",
    accent: "text-cyan-300",
  },
  emerald: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(16_185_129/0.26),inset_0_-1px_0_0_rgb(16_185_129/0.08),inset_1px_0_0_0_rgb(16_185_129/0.08),inset_-1px_0_0_0_rgb(16_185_129/0.08)]",
    bg: "bg-gradient-to-br from-emerald-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-emerald-300",
    accent: "text-emerald-300",
  },
  violet: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(139_92_246/0.26),inset_0_-1px_0_0_rgb(139_92_246/0.08),inset_1px_0_0_0_rgb(139_92_246/0.08),inset_-1px_0_0_0_rgb(139_92_246/0.08)]",
    bg: "bg-gradient-to-br from-violet-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-violet-300",
    accent: "text-violet-300",
  },
  fuchsia: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(217_70_239/0.26),inset_0_-1px_0_0_rgb(217_70_239/0.08),inset_1px_0_0_0_rgb(217_70_239/0.08),inset_-1px_0_0_0_rgb(217_70_239/0.08)]",
    bg: "bg-gradient-to-br from-fuchsia-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-fuchsia-300",
    accent: "text-fuchsia-300",
  },
  orange: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(249_115_22/0.26),inset_0_-1px_0_0_rgb(249_115_22/0.08),inset_1px_0_0_0_rgb(249_115_22/0.08),inset_-1px_0_0_0_rgb(249_115_22/0.08)]",
    bg: "bg-gradient-to-br from-orange-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-orange-300",
    accent: "text-orange-300",
  },
  sky: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(14_165_233/0.26),inset_0_-1px_0_0_rgb(14_165_233/0.08),inset_1px_0_0_0_rgb(14_165_233/0.08),inset_-1px_0_0_0_rgb(14_165_233/0.08)]",
    bg: "bg-gradient-to-br from-sky-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-sky-300",
    accent: "text-sky-300",
  },
  lime: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(132_204_22/0.26),inset_0_-1px_0_0_rgb(132_204_22/0.08),inset_1px_0_0_0_rgb(132_204_22/0.08),inset_-1px_0_0_0_rgb(132_204_22/0.08)]",
    bg: "bg-gradient-to-br from-lime-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-lime-300",
    accent: "text-lime-300",
  },
  // Silver — used for P2 podium chips. Lower saturation than the others so the
  // grey reads as "neutral medal" against gold/bronze. Uses zinc-400 rather
  // than 500 so the silver highlight stays visible on the dark surface.
  zinc: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(161_161_170/0.26),inset_0_-1px_0_0_rgb(161_161_170/0.08),inset_1px_0_0_0_rgb(161_161_170/0.08),inset_-1px_0_0_0_rgb(161_161_170/0.08)]",
    bg: "bg-gradient-to-br from-zinc-400/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-zinc-200",
    accent: "text-zinc-200",
  },
  // Purple — established convention for "session best" lap/sector highlights.
  // Tailwind 'purple' rather than 'violet' to match existing text-purple-400 use
  // across data tables (LapTimeChart, QualifyingTable, SessionCard).
  purple: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(168_85_247/0.26),inset_0_-1px_0_0_rgb(168_85_247/0.08),inset_1px_0_0_0_rgb(168_85_247/0.08),inset_-1px_0_0_0_rgb(168_85_247/0.08)]",
    bg: "bg-gradient-to-br from-purple-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-purple-300",
    accent: "text-purple-300",
  },
} as const satisfies Record<string, AccentToken>;

export type AccentColor = keyof typeof ACCENT_TOKENS;

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
