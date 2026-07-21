import type { TyreSetData, TyreSetsData } from "../types/telemetry";
import { getHarderCompoundWearCalibration } from "../constants/compoundWear";
import { getFormulaComparisonKey } from "../utils/sessionTypes";
import { median } from "../utils/stats/core";
import type {
  CompoundLifeStats,
  CompoundLifeSample,
} from "../utils/stats/trackAggregates";
import { estimateMaxLife } from "../utils/stats/tyres";
import type { BucketRaceEntry } from "./trackStrategyTypes";

const DRY_VISUAL_COMPOUNDS = ["Soft", "Medium", "Hard"] as const;
const MAX_FRESH_SET_WEAR = 5;
const MAX_PACKET_COMPOUND_GAP_MS = 3_000;

export type StrategyWearSource = "observed" | "game-usable-life";

export interface StrategyCompoundStats extends CompoundLifeStats {
  actualCompound?: string;
  wearSource: StrategyWearSource;
}

export interface StrategyTyreAllocation {
  formulaKey: string;
  compounds: Map<string, TyreSetData>;
  packetPaceOffsetsMs: Map<string, number> | null;
}

export interface StrategyCompoundEvidence {
  compounds: StrategyCompoundStats[];
  allocation: StrategyTyreAllocation | null;
  inferredCompounds: Set<string>;
}

function isActualDryCompound(compound: string): boolean {
  return /^C\d+$/.test(compound);
}

function actualCompoundNumber(compound: string): number | null {
  const match = compound.match(/^C(\d+)$/);
  return match ? Number(match[1]) : null;
}

function representativeSetForVisual(
  rows: TyreSetData[],
  visualCompound: string,
): TyreSetData | null {
  const candidates = rows
    .filter(
      (row) =>
        row["visual-tyre-compound"] === visualCompound &&
        isActualDryCompound(row["actual-tyre-compound"]) &&
        Number.isFinite(row.wear) &&
        row.wear <= MAX_FRESH_SET_WEAR &&
        Number.isFinite(row["usable-life"]) &&
        row["usable-life"] > 0,
    )
    .sort((a, b) => {
      if (a.wear !== b.wear) return a.wear - b.wear;
      const aRace = a["recommended-session"] === "Race" ? 1 : 0;
      const bRace = b["recommended-session"] === "Race" ? 1 : 0;
      if (aRace !== bRace) return bRace - aRace;
      return Number(b.available) - Number(a.available);
    });

  const representative = candidates[0];
  if (!representative) return null;

  const matchingFreshSets = candidates.filter(
    (candidate) =>
      candidate.wear === representative.wear &&
      candidate["actual-tyre-compound"] ===
        representative["actual-tyre-compound"],
  );
  const lapDeltaTime = median(
    matchingFreshSets
      .map((candidate) => candidate["lap-delta-time"])
      .filter(Number.isFinite),
  );

  // Duplicate unused sets can disagree by a packet or two. Their median is a
  // steadier representative than whichever duplicate happened to sort first.
  return lapDeltaTime == null
    ? representative
    : { ...representative, "lap-delta-time": lapDeltaTime };
}

function validPacketPaceOffsets(
  compounds: Map<string, TyreSetData>,
): Map<string, number> | null {
  const rows = DRY_VISUAL_COMPOUNDS.map((visual) => compounds.get(visual));
  if (rows.some((row) => row == null || row.wear !== 0)) return null;

  const completeRows = rows.filter((row): row is TyreSetData => row != null);
  const actualNumbers = completeRows.map((row) =>
    actualCompoundNumber(row["actual-tyre-compound"]),
  );
  const deltas = completeRows.map((row) => row["lap-delta-time"]);
  if (
    actualNumbers.some((value) => value == null) ||
    deltas.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }

  // A valid allocation gets physically harder and slower from Soft to Hard.
  // Reject corrupt/stale packets instead of granting them medium confidence.
  for (let index = 1; index < completeRows.length; index++) {
    const actualStep = actualNumbers[index - 1]! - actualNumbers[index]!;
    const paceGapMs = deltas[index] - deltas[index - 1];
    if (
      actualStep <= 0 ||
      paceGapMs <= 0 ||
      paceGapMs > MAX_PACKET_COMPOUND_GAP_MS
    ) {
      return null;
    }
  }

  const fastestDelta = Math.min(...deltas);
  return new Map(
    completeRows.map((row, index) => [
      DRY_VISUAL_COMPOUNDS[index],
      row["lap-delta-time"] - fastestDelta,
    ]),
  );
}

function allocationFromPacket(
  packet: TyreSetsData | undefined,
  formulaKey: string,
): StrategyTyreAllocation | null {
  if (!packet) return null;

  const compounds = new Map<string, TyreSetData>();
  for (const visual of DRY_VISUAL_COMPOUNDS) {
    const representative = representativeSetForVisual(
      packet["tyre-set-data"],
      visual,
    );
    if (!representative) return null;
    compounds.set(visual, representative);
  }

  const actualCompounds = new Set(
    [...compounds.values()].map((row) => row["actual-tyre-compound"]),
  );
  if (actualCompounds.size !== compounds.size) return null;

  const packetPaceOffsetsMs = validPacketPaceOffsets(compounds);

  return { formulaKey, compounds, packetPaceOffsetsMs };
}

function allocationPackets(entry: BucketRaceEntry): TyreSetsData[] {
  const perLapPackets = [...(entry.player["per-lap-info"] ?? [])]
    .sort((a, b) => a["lap-number"] - b["lap-number"])
    .flatMap((lap) => (lap["tyre-sets-data"] ? [lap["tyre-sets-data"]] : []));
  return [
    ...perLapPackets,
    ...(entry.player["tyre-sets"] ? [entry.player["tyre-sets"]] : []),
  ];
}

export function findStrategyTyreAllocation(
  entries: BucketRaceEntry[],
): StrategyTyreAllocation | null {
  let usableLifeFallback: StrategyTyreAllocation | null = null;
  for (const entry of [...entries].reverse()) {
    const formulaKey = getFormulaComparisonKey(
      entry.session["session-info"].formula,
      entry.session["game-year"],
    );
    if (formulaKey !== "f1-25" && formulaKey !== "f1-26") continue;

    for (const packet of allocationPackets(entry)) {
      const allocation = allocationFromPacket(packet, formulaKey);
      if (!allocation) continue;
      if (allocation.packetPaceOffsetsMs) return allocation;
      usableLifeFallback ??= allocation;
    }
  }
  return usableLifeFallback;
}

function observedStrategyStats(
  stats: CompoundLifeStats[],
  allocation: StrategyTyreAllocation | null,
): StrategyCompoundStats[] {
  return stats.map((stat) => ({
    ...stat,
    actualCompound: allocation?.compounds.get(stat.compound)?.[
      "actual-tyre-compound"
    ],
    wearSource: "observed",
  }));
}

function inferredStat(
  compound: string,
  actualCompound: string,
  wearRatePerLap: number,
): StrategyCompoundStats {
  return {
    compound,
    actualCompound,
    avgWearRatePerLap: wearRatePerLap,
    estMaxLife: estimateMaxLife(wearRatePerLap),
    avgStintLength: 0,
    longestStint: 0,
    stintCount: 0,
    bestLapMs: 0,
    samples: [] as CompoundLifeSample[],
    wearSource: "game-usable-life",
  };
}

export function buildStrategyCompoundEvidence(
  observedStats: CompoundLifeStats[],
  entries: BucketRaceEntry[],
): StrategyCompoundEvidence {
  const allocation = findStrategyTyreAllocation(entries);
  const compounds = observedStrategyStats(observedStats, allocation);
  const inferredCompounds = new Set<string>();
  if (!allocation) return { compounds, allocation, inferredCompounds };

  const observedAllocatedCompounds = compounds.filter(
    (stat) =>
      stat.avgWearRatePerLap > 0 && allocation.compounds.has(stat.compound),
  );
  // Two real compounds already unlock the existing strategy model. Keep that
  // path byte-for-byte stable and only synthesize when sparse evidence would
  // otherwise suppress the Strategy section entirely.
  if (observedAllocatedCompounds.length >= 2) {
    return { compounds, allocation, inferredCompounds };
  }

  const calibrations = observedAllocatedCompounds.flatMap((stat) => {
    const usableLife = allocation.compounds.get(stat.compound)?.["usable-life"];
    return stat.avgWearRatePerLap > 0 && usableLife != null && usableLife > 0
      ? [stat.avgWearRatePerLap * usableLife]
      : [];
  });
  const wearCalibration = median(calibrations);
  if (wearCalibration == null || wearCalibration <= 0) {
    return { compounds, allocation, inferredCompounds };
  }

  const observedNames = new Set(compounds.map((stat) => stat.compound));
  const observedVisual = DRY_VISUAL_COMPOUNDS.find((compound) =>
    observedNames.has(compound),
  );
  if (!observedVisual) return { compounds, allocation, inferredCompounds };

  // The current leave-one-compound-out corpus validates Medium -> Hard only.
  // Soft-only and Hard-only evidence abstain until they have direction-specific
  // wear calibration instead of presenting a risky guess as race guidance.
  if (observedVisual !== "Medium") {
    return { compounds, allocation, inferredCompounds };
  }
  const targetVisual = "Hard";
  const targetRow = allocation.compounds.get(targetVisual);
  if (!targetRow) return { compounds, allocation, inferredCompounds };

  // Raw usable-life scaling overpredicted held-out Hard wear by ~37% (F1 25)
  // and ~23% (F1 26). These shrunk factors retain a safety bias while making
  // the fallback useful on high-wear tracks.
  const observedActual =
    allocation.compounds.get(observedVisual)?.["actual-tyre-compound"];
  const calibrationFactor = observedActual
    ? getHarderCompoundWearCalibration(
        allocation.formulaKey,
        observedActual,
        targetRow["actual-tyre-compound"],
      )
    : null;
  if (calibrationFactor == null) {
    return { compounds, allocation, inferredCompounds };
  }
  const wearRatePerLap =
    (wearCalibration / targetRow["usable-life"]) * calibrationFactor;
  if (!Number.isFinite(wearRatePerLap) || wearRatePerLap <= 0) {
    return { compounds, allocation, inferredCompounds };
  }

  compounds.push(
    inferredStat(
      targetVisual,
      targetRow["actual-tyre-compound"],
      wearRatePerLap,
    ),
  );
  inferredCompounds.add(targetVisual);

  return { compounds, allocation, inferredCompounds };
}
