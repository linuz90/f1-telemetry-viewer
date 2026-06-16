import type { CSSProperties } from "react";
import { getCompoundColor } from "../../utils/colors";

/**
 * Shared visual treatment for tyre-compound stint chips — the colored blocks
 * used by both the race-view StintTimeline and the track-page strategy
 * ribbons. The look mirrors F1 broadcast graphics: full-saturation compound
 * color with a subtle vertical gloss (lighter top edge, slightly darker
 * bottom) and an inset 1px highlight/shadow that gives the chip a beveled
 * feel without competing with the data.
 *
 * Both callsites should style their compound segments via this helper so a
 * Soft block in the race timeline reads as the same chip family as a Soft
 * block in a strategy projection.
 */

/** Compounds whose base color is bright enough that dark text reads better
 *  than white. Medium (#eab308) is yellow, Hard (#e5e7eb) is near-white, and
 *  the C1–C3 fallback aliases match those visually. */
const LIGHT_BG_COMPOUNDS = new Set(["Medium", "Hard", "C1", "C2", "C3"]);

export function stintChipStyle(compound: string): CSSProperties {
  const color = getCompoundColor(compound);
  return {
    // Two-layer background: a subtle white→black gloss overlay on top of the
    // solid compound color. The overlay is what creates the "polished" feel
    // without needing per-compound darker/lighter sibling tokens.
    backgroundColor: color,
    backgroundImage:
      "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.16) 100%)",
    // Beveled edges — a hairline white inset at the top and a hairline black
    // inset at the bottom read as "raised pill" against the dark surface.
    boxShadow: [
      "inset 0 1px 0 0 rgba(255,255,255,0.28)",
      "inset 0 -1px 0 0 rgba(0,0,0,0.22)",
    ].join(", "),
    color: LIGHT_BG_COMPOUNDS.has(compound) ? "#18181b" : "#fff",
  };
}

/** Style for the chip's textual content — sits over the gloss-overlay
 *  background, so we add a faint shadow on the text so it stays legible on
 *  the brighter top edge of the gradient. */
export function stintChipTextStyle(compound: string): CSSProperties {
  const isLightBg = LIGHT_BG_COMPOUNDS.has(compound);
  return {
    textShadow: isLightBg
      ? "0 1px 0 rgba(255,255,255,0.35)"
      : "0 1px 0 rgba(0,0,0,0.45)",
  };
}
