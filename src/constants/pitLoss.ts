/**
 * F1 pit-loss defaults adapted from Pits n' Giggles:
 * /lib/config/schema/pit_time_loss_f1.py
 *
 * Source project license: MIT, Copyright (c) 2025 Ashwin Natarajan.
 * Values are seconds lost for a normal green-flag stop, converted to ms here.
 */

const F1_PIT_LOSS_DEFAULT_SECONDS: Record<string, number> = {
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
  austria: 19,
  austriareverse: 19,
  silverstone: 28,
  hungaroring: 20,
  zandvoort: 18,
  spa: 18,
  zandvoortreverse: 18,
  monza: 24,
  baku: 18,
  singapore: 26,
  texas: 20,
  mexico: 22,
  brazil: 20,
  lasvegas: 20,
  losail: 25,
  abudhabi: 19,
};

const F1_PIT_LOSS_ALIASES: Record<string, string> = {
  australia: "melbourne",
  bahrain: "sakhir",
  saudiarabia: "jeddah",
  japan: "suzuka",
  china: "shanghai",
  spain: "catalunya",
  barcelona: "catalunya",
  canada: "montreal",
  spielberg: "austria",
  hungary: "hungaroring",
  budapest: "hungaroring",
  belgium: "spa",
  netherlands: "zandvoort",
  italy: "monza",
  azerbaijan: "baku",
  marina: "singapore",
  marinabay: "singapore",
  austin: "texas",
  cota: "texas",
  saopaulo: "brazil",
  vegas: "lasvegas",
  qatar: "losail",
  lusail: "losail",
  yasmarina: "abudhabi",
};

function normalizePitLossTrackKey(trackId: string): string {
  const compact = trackId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return F1_PIT_LOSS_ALIASES[compact] ?? compact;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export const F1_PIT_LOSS_FAMILY_MEDIAN_MS =
  median(Object.values(F1_PIT_LOSS_DEFAULT_SECONDS)) * 1000;

export function getF1PitLossDefaultMs(trackId: string): number | null {
  const key = normalizePitLossTrackKey(trackId);
  const seconds = F1_PIT_LOSS_DEFAULT_SECONDS[key];
  return seconds == null ? null : seconds * 1000;
}
