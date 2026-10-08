/**
 * Physically consistent synthetic laps for the `/ui-debug` fixture and the
 * lap-telemetry tests. Never used for real recordings.
 */

export type SyntheticChannels = Record<string, number[]>;

export function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) out.push(value);
  return out;
}

export interface Corner {
  apex: number;
  minKmh: number;
  /** Where braking starts (m before the apex). */
  brakeFor?: number;
}

export interface SyntheticLapOptions {
  trackLengthM: number;
  corners: Corner[];
  topKmh?: number;
  /** Speed taken off along a stretch, e.g. to model running out of battery. */
  speedLoss?: (distance: number) => number;
  /** Stored battery energy in joules along the lap. */
  battery?: (distance: number) => number;
  /** Repeat the previous clock value on every other sample, as the beta does. */
  staleClock?: boolean;
  stepM?: number;
}

/**
 * Distance-sampled lap with consistent speed, inputs and clock: straights at
 * top speed, linear braking into each apex, linear acceleration out.
 */
export function syntheticLap(options: SyntheticLapOptions): {
  channels: SyntheticChannels;
  lapTimeMs: number;
} {
  const top = options.topKmh ?? 300;
  const step = options.stepM ?? 2;
  const accelM = 300;
  const speedAt = (d: number) => {
    let v = top;
    for (const corner of options.corners) {
      const brakeFor = corner.brakeFor ?? 150;
      if (d >= corner.apex - brakeFor && d <= corner.apex) {
        v = Math.min(
          v,
          top +
            ((corner.minKmh - top) * (d - (corner.apex - brakeFor))) / brakeFor,
        );
      } else if (d > corner.apex && d <= corner.apex + accelM) {
        v = Math.min(
          v,
          corner.minKmh + ((top - corner.minKmh) * (d - corner.apex)) / accelM,
        );
      }
    }
    return v - (options.speedLoss?.(d) ?? 0);
  };
  const inputsAt = (d: number) => {
    for (const corner of options.corners) {
      const brakeFor = corner.brakeFor ?? 150;
      if (d >= corner.apex - brakeFor && d < corner.apex) {
        return {
          throttle: 0,
          brake: d < corner.apex - 20 ? 90 : 30,
          steering: d > corner.apex - 60 ? 40 : 0,
        };
      }
      if (d >= corner.apex && d < corner.apex + 60) {
        return {
          throttle: 40 + ((d - corner.apex) / 60) * 55,
          brake: 0,
          steering: 30,
        };
      }
    }
    return { throttle: 100, brake: 0, steering: 0 };
  };

  const distance: number[] = [-20, -10];
  for (const d of range(1, options.trackLengthM - 1, step)) distance.push(d);
  const clock: number[] = [];
  let t = 0;
  let previous = 0;
  for (const d of distance) {
    if (d > 0) {
      const v = (speedAt(previous) + speedAt(d)) / 2 / 3.6;
      t += (d - previous) / v;
      previous = d;
    }
    clock.push(d < 0 ? 0 : t * 1000);
  }
  const tail = (options.trackLengthM - previous) / (speedAt(previous) / 3.6);
  const lapTimeMs = Math.round((t + tail) * 1000);
  if (options.staleClock) {
    for (let i = 3; i < clock.length; i += 2) clock[i] = clock[i - 1];
  }
  const inputs = distance.map((d) => inputsAt(Math.max(d, 0)));
  const speed = distance.map((d) => speedAt(Math.max(d, 0)));
  return {
    lapTimeMs,
    channels: {
      lap_distance: distance,
      lap_time_ms: clock,
      speed,
      throttle: inputs.map((input) => input.throttle),
      brake: inputs.map((input) => input.brake),
      steering: inputs.map((input) => input.steering),
      gear: speed.map((v) => Math.max(1, Math.min(8, Math.ceil(v / 40)))),
      engine_rpm: speed.map((v) => 8000 + (v % 40) * 100),
      "ers.deploy_mode": distance.map(() => 0),
      "ers.store_energy_j": distance.map(
        (d) => options.battery?.(Math.max(d, 0)) ?? 2_000_000,
      ),
      "ers.store_energy": distance.map(() => 50),
      "tyre_wear.fl": distance.map(() => 3),
      "tyre_wear.fr": distance.map(() => 3),
      "tyre_wear.rl": distance.map(() => 2),
      "tyre_wear.rr": distance.map(() => 2),
    },
  };
}
