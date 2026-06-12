import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

// Threshold matches `gridGainTone` / `signedNumber` (helpers.ts) so the glyph,
// the color, and the printed delta always agree on "is this a real movement?".
// A 0.5 threshold here used to render emerald "+0.3" with a flat Minus glyph.
export function GridGainGlyph({ value }: { value: number | undefined }) {
  if (value == null || Math.abs(value) < 0.05)
    return <Minus className="size-3.5" />;
  return value > 0 ? (
    <ArrowUpRight className="size-3.5" />
  ) : (
    <ArrowDownRight className="size-3.5" />
  );
}
