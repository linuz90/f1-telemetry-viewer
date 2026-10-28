import { getCompoundColor } from "../../utils/colors";

/** Stripe pattern for the projected part of an evidence bar. */
const PROJECTION_STRIPES =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.28) 0 2px, transparent 2px 6px)";

/**
 * Solid = the longest green-flag run actually driven on a compound and the
 * worst-wheel wear it added; stripes = the projection from there to the
 * threshold. Practice races are usually partial, so most tyre-life numbers
 * extrapolate past the evidence; this makes the share that is guesswork
 * visible. Tyre life counts green-flag laps, so the evidence does too: laps
 * behind the Safety Car would draw solid bar the projection never used.
 */
export function TyreLifeEvidenceBar({
  compound,
  seenLaps,
  seenWear,
  estLife,
}: {
  compound: string;
  seenLaps: number;
  seenWear: number;
  estLife: number;
}) {
  const color = getCompoundColor(compound);
  const span = Math.max(estLife, seenLaps, 1);
  const seenPct = Math.min(100, (seenLaps / span) * 100);

  return (
    <div>
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${seenPct}%`, backgroundColor: color, opacity: 0.9 }}
        />
        {seenPct < 100 && (
          <div
            className="absolute inset-y-0 right-0"
            style={{
              width: `${100 - seenPct}%`,
              backgroundImage: PROJECTION_STRIPES,
            }}
          />
        )}
      </div>
      <div className="mt-1 whitespace-nowrap font-mono text-2xs tabular-nums text-zinc-500">
        seen {seenLaps} green laps · {Math.round(seenWear)}%
      </div>
    </div>
  );
}
