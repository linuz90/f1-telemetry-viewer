/** Shared numeric and display helpers for telemetry stats modules. */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid];
}

/** Linearly interpolated quantile for a finite sample (q from 0 to 1). */
export function quantile(
  values: readonly number[],
  q: number,
): number | undefined {
  if (values.length === 0 || !Number.isFinite(q) || q < 0 || q > 1) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Helper: format ms to lap time string */
export function msToLapTimeLocal(ms: number): string {
  if (ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? minutes + ":" + seconds.padStart(6, "0") : seconds;
}

/** Format a lap delta as "+X.X" or "-X.X" */
export function formatLapDelta(delta: number): string {
  return delta >= 0 ? "+" + delta.toFixed(1) : delta.toFixed(1);
}
