/**
 * Round lap-time ticks for charts that let a library draw the axis: steps of
 * 0.1 to 10 s, a domain that starts and ends on a tick, and labels like
 * "1:27" or "1:27.5" instead of Recharts' "1:27.450".
 */
const STEPS_MS = [100, 200, 250, 500, 1000, 2000, 5000, 10000];

export function lapTimeAxis(
  minMs: number,
  maxMs: number,
  targetTicks = 5,
): { domain: [number, number]; ticks: number[]; stepMs: number } {
  const range = Math.max(maxMs - minMs, 100);
  const stepMs =
    STEPS_MS.find((step) => range / step <= targetTicks) ?? STEPS_MS.at(-1)!;
  const lo = Math.floor(minMs / stepMs) * stepMs;
  const hi = Math.max(lo + stepMs, Math.ceil(maxMs / stepMs) * stepMs);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1; t += stepMs) ticks.push(t);
  return { domain: [lo, hi], ticks, stepMs };
}

export function formatLapTick(ms: number, stepMs: number): string {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  const digits = stepMs % 1000 === 0 ? 0 : stepMs % 100 === 0 ? 1 : 2;
  return `${minutes}:${seconds.toFixed(digits).padStart(digits ? digits + 3 : 2, "0")}`;
}
