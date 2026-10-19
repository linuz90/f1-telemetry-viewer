import type { RacePaceLapSample } from "./laps";

// ────────────────────────────────────────────────────────────────────────────
// Peak pace — the mean of a driver's fastest PEAK_PACE_WINDOW race-pace laps.
//
// One definition and one label ("Peak pace") for every surface that shows it:
// Track Progress tyre cards, Peak Pace Evolution, any future driver table.
//
// Why the fastest-three mean, not a stint median or the single best lap:
//   • A median across a whole stint is biased against long stints: tyre
//     degradation in the tail drags it down, so a 5-lap stint looks faster
//     than a 25-lap stint whose peak laps were actually quicker.
//   • A single best lap is a flyer. Across ~3.4k driver-compound race groups
//     it sits a median 0.18 s (p90 0.70 s) clear of the second-fastest lap,
//     and in 13% of groups it deploys 1 MJ+ more ERS than that group's
//     typical lap. Averaging three dilutes one such lap to a third of its
//     gap, about 0.03 s, while still measuring peak rather than sustained
//     pace. Five laps is half a typical partial-race stint and drifts
//     toward Race Pace; a median of three is just the second-fastest lap.
//
// Samples arrive already filtered for completeness, SC/VSC, pit laps and
// per-stint MAD outliers by `getRacePaceLapSamples`. This measures pace
// potential, not Race Pace: longer runs have more chances to supply a fast
// window, so the lap count travels with the value.
// ────────────────────────────────────────────────────────────────────────────

export const PEAK_PACE_WINDOW = 3;

export const PEAK_PACE_LABEL = "Peak pace";

export const PEAK_PACE_TOOLTIP = `Mean of the fastest ${PEAK_PACE_WINDOW} clean race laps: complete green-flag laps after excluding lap 1, pit in/out laps, and abnormal per-stint outliers. At least ${PEAK_PACE_WINDOW} laps are required.`;

export interface PeakPaceEstimate {
  timeMs: number;
  /** Eligible race-pace laps the window was drawn from. */
  sampleCount: number;
}

export function calculatePeakPace(
  samples: readonly RacePaceLapSample[],
): PeakPaceEstimate | null {
  if (samples.length < PEAK_PACE_WINDOW) return null;
  const window = samples
    .map((sample) => sample.timeMs)
    .sort((a, b) => a - b)
    .slice(0, PEAK_PACE_WINDOW);
  return {
    timeMs: window.reduce((sum, timeMs) => sum + timeMs, 0) / window.length,
    sampleCount: samples.length,
  };
}
