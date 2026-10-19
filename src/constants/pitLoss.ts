import { getTrackId } from "../utils/tracks";

/**
 * F1 pit-loss defaults adapted from Pits n' Giggles:
 * /lib/config/schema/pit_time_loss_f1.py
 *
 * Source project license: MIT, Copyright (c) 2025 Ashwin Natarajan.
 * Values are seconds lost for a normal green-flag stop, converted to ms here.
 * Keyed by canonical track id, not the source file's own track names.
 */

export const F1_PIT_LOSS_DEFAULT_SECONDS: Record<string, number> = {
  melbourne: 18,
  shanghai: 22,
  suzuka: 22,
  sakhir: 23,
  jeddah: 18,
  miami: 19,
  imola: 27,
  monaco: 19,
  catalunya: 21,
  montreal: 16,
  spielberg: 19,
  "spielberg-reverse": 19,
  silverstone: 28,
  hungaroring: 20,
  zandvoort: 18,
  spa: 18,
  "zandvoort-reverse": 18,
  monza: 24,
  baku: 18,
  "marina-bay": 26,
  austin: 20,
  "mexico-city": 22,
  interlagos: 20,
  "las-vegas": 20,
  lusail: 25,
  "yas-marina": 19,
  // TODO: Add Madrid/Madring once Pits n' Giggles publishes a sourced F1 pit-loss default.
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export const F1_PIT_LOSS_FAMILY_MEDIAN_MS =
  median(Object.values(F1_PIT_LOSS_DEFAULT_SECONDS)) * 1000;

/** Accepts any exporter alias; every alias of a circuit shares its default. */
export function getF1PitLossDefaultMs(track: string): number | null {
  const seconds = F1_PIT_LOSS_DEFAULT_SECONDS[getTrackId(track)];
  return seconds == null ? null : seconds * 1000;
}
