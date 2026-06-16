import type { CSSProperties } from "react";
import { getCompoundColor } from "../../utils/colors";

/**
 * Shared visual treatment for tyre-compound stint chips — the colored blocks
 * used by both the race-view StintTimeline and the track-page strategy
 * ribbons. The look mirrors F1 broadcast graphics: full-saturation compound
 * color with a subtle vertical gloss and a faint compound-tinted glow that
 * lifts the chip off the dark surface without the dated bevel effect.
 *
 * Both callsites should style their compound segments via this helper so a
 * Soft block in the race timeline reads as the same chip family as a Soft
 * block in a strategy projection.
 */

/** Compounds whose base color is bright enough that dark text reads better
 *  than white. Medium (#eab308) is yellow, Hard (#e5e7eb) is near-white, and
 *  the C1–C3 fallback aliases match those visually. */
const LIGHT_BG_COMPOUNDS = new Set(["Medium", "Hard", "C1", "C2", "C3"]);

/** Parse a `#rrggbb` color into an `r, g, b` triplet usable inside `rgba()`. */
function hexToRgbTriplet(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function stintChipStyle(compound: string): CSSProperties {
  const color = getCompoundColor(compound);
  const rgb = hexToRgbTriplet(color);
  return {
    backgroundColor: color,
    // Subtle vertical gradient kept from the broadcast look, but lighter than
    // before so the chip reads flat-modern rather than glossy.
    backgroundImage:
      "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.10) 100%)",
    // Soft compound-tinted outer glow instead of the old inset bevel — gives
    // the chip a hint of lift against the dark surface. Callers MUST avoid
    // `overflow-hidden` on the wrapping ribbon, otherwise this gets clipped.
    boxShadow: `0 0 30px 0 rgba(${rgb}, 0.12)`,
    color: LIGHT_BG_COMPOUNDS.has(compound) ? "#18181b" : "#fff",
  };
}

/** Style for the chip's textual content. The flat background no longer needs
 *  a text shadow, so this is a no-op kept for API stability with callsites. */
export function stintChipTextStyle(_compound: string): CSSProperties {
  return {};
}
