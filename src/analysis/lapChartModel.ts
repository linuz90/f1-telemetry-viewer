import type { DriverData, TelemetrySession } from "../types/telemetry";
import { getRaceControlEvents } from "../utils/raceControl";
import {
  getPitLapNumbers,
  getRacePaceLapSamples,
  hasCompleteLapTiming,
  isCompleteValidLap,
} from "../utils/stats/laps";
import {
  getCompletedStints,
  getDriverStints,
  getStintWearCurve,
} from "../utils/stats/tyres";

/**
 * Plain data for the lap chart: one driver's lap times with the reason each
 * uncounted lap is out of Race Pace, the stints, safety-car periods, pit
 * in-laps and the driver's own contacts and warnings. Race Pace rules come from
 * `getRacePaceLapSamples()`, so the chart's "faded" laps are exactly the laps
 * the Race Pace number leaves out.
 */

export interface LapChartStintData {
  from: number;
  to: number;
  compound: string;
  /** Mean of the stint's counted laps, when it has two or more. */
  averageMs: number | null;
}

export interface DriverLapSeries {
  lapsMs: (number | null)[];
  excluded: Map<number, string>;
  stints: LapChartStintData[];
  pitInLaps: number[];
  /** Worst-wheel wear %, index lap - 1. */
  wear: (number | null)[];
  compoundByLap: Map<number, string>;
}

export function buildDriverLapSeries(
  driver: DriverData,
  session: TelemetrySession,
): DriverLapSeries {
  const laps = driver["session-history"]["lap-history-data"];
  const counted = new Set(
    getRacePaceLapSamples(driver).map((s) => s.lapNumber),
  );
  const pitLaps = getPitLapNumbers(driver);
  const stints = getCompletedStints(getDriverStints(driver));
  const pitIn = new Set(stints.slice(0, -1).map((s) => s["end-lap"]));
  const scByLap = new Map(
    (driver["per-lap-info"] ?? []).map((info) => [
      info["lap-number"],
      info["max-safety-car-status"] ?? "NO_SAFETY_CAR",
    ]),
  );
  const isRace = /^race/i.test(session["session-info"]["session-type"]);

  const lapsMs: (number | null)[] = [];
  const excluded = new Map<number, string>();
  laps.forEach((lap, index) => {
    const lapNumber = index + 1;
    const ms = hasCompleteLapTiming(lap) ? lap["lap-time-in-ms"] : null;
    lapsMs.push(ms);
    if (ms == null || counted.has(lapNumber)) return;
    if (!isRace) {
      if (!isCompleteValidLap(lap)) excluded.set(lapNumber, "deleted");
      return;
    }
    const sc = scByLap.get(lapNumber) ?? "NO_SAFETY_CAR";
    const reason =
      lapNumber === 1
        ? "start"
        : !isCompleteValidLap(lap)
          ? "invalid"
          : sc === "VIRTUAL_SAFETY_CAR"
            ? "VSC"
            : sc !== "NO_SAFETY_CAR"
              ? "safety car"
              : pitIn.has(lapNumber)
                ? "pit in"
                : pitLaps.has(lapNumber)
                  ? "pit out"
                  : "outlier";
    excluded.set(lapNumber, reason);
  });

  const compoundByLap = new Map<number, string>();
  const wear: (number | null)[] = laps.map(() => null);
  const chartStints = stints.map((stint) => {
    const compound = stint["tyre-set-data"]["visual-tyre-compound"];
    for (let lap = stint["start-lap"]; lap <= stint["end-lap"]; lap++) {
      compoundByLap.set(lap, compound);
    }
    for (const point of getStintWearCurve(stint)) {
      wear[point.lapNumber - 1] = point.worstWear;
    }
    const stintCounted = [...counted].filter(
      (lap) => lap >= stint["start-lap"] && lap <= stint["end-lap"],
    );
    const times = stintCounted
      .map((lap) => lapsMs[lap - 1])
      .filter((ms): ms is number => ms != null);
    return {
      from: stint["start-lap"],
      to: Math.min(stint["end-lap"], laps.length),
      compound,
      averageMs:
        times.length >= 2
          ? times.reduce((a, b) => a + b, 0) / times.length
          : null,
    };
  });

  return {
    lapsMs,
    excluded,
    stints: chartStints,
    pitInLaps: [...pitIn].filter((lap) => lap < laps.length),
    wear,
    compoundByLap,
  };
}

export interface LapChartBand {
  from: number;
  to: number;
  label: "SC" | "VSC";
}

/** Contiguous safety-car and VSC laps, from the focused driver's lap info. */
export function buildSafetyCarBands(driver: DriverData): LapChartBand[] {
  const bands: LapChartBand[] = [];
  for (const info of driver["per-lap-info"] ?? []) {
    const status = info["max-safety-car-status"] ?? "NO_SAFETY_CAR";
    if (status === "NO_SAFETY_CAR" || info["lap-number"] < 1) continue;
    const label = status === "VIRTUAL_SAFETY_CAR" ? "VSC" : "SC";
    const last = bands[bands.length - 1];
    if (last && last.label === label && last.to === info["lap-number"] - 1) {
      last.to = info["lap-number"];
    } else {
      bands.push({ from: info["lap-number"], to: info["lap-number"], label });
    }
  }
  return bands;
}

export interface DriverLapEvent {
  lap: number;
  kind: "contact" | "warning";
  text: string;
}

/** The driver's own contacts and warnings or penalties, by lap. */
export function buildDriverEvents(
  session: TelemetrySession,
  driver: DriverData,
): DriverLapEvent[] {
  const nameByIndex = new Map(
    (session["classification-data"] ?? []).map((d) => [
      d.index,
      d["driver-name"],
    ]),
  );
  const events: DriverLapEvent[] = [];
  const seenContacts = new Set<string>();
  for (const event of getRaceControlEvents(session)) {
    const lap = event["lap-number"];
    if (lap == null || lap < 1) continue;
    if (
      event["message-type"] === "COLLISION" &&
      event["involved-drivers"]?.includes(driver.index)
    ) {
      const others = event["involved-drivers"]
        .filter((i) => i !== driver.index)
        .map((i) => nameByIndex.get(i))
        .filter(Boolean)
        .join(", ");
      const key = `${lap}:${others}`;
      if (seenContacts.has(key)) continue;
      seenContacts.add(key);
      events.push({
        lap,
        kind: "contact",
        text: others ? `Contact with ${others}` : "Contact",
      });
    }
  }
  for (const entry of driver["warning-penalty-history"] ?? []) {
    if (entry["lap-number"] < 1) continue;
    events.push({
      lap: entry["lap-number"],
      kind: "warning",
      text: entry["entry-type"].replace(/ warning$/i, " warning"),
    });
  }
  return events.sort((a, b) => a.lap - b.lap);
}
