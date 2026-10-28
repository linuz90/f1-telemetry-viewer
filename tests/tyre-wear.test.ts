import assert from "node:assert/strict";
import test from "node:test";
import type { PerLapInfo, TyreStint } from "../src/types/telemetry";
import { buildStintDetails } from "../src/analysis/stintAnalysis";
import { getNeutralisedLaps, stintWearRate } from "../src/utils/stats/tyres";

/** A stint whose history holds worst-wheel wear by lap number, including any
 *  snapshot PnG logs on the lap before the stint. */
function buildStint(
  startLap: number,
  endLap: number,
  wearByLap: Record<number, number>,
): TyreStint {
  return {
    "start-lap": startLap,
    "end-lap": endLap,
    "stint-length": endLap - startLap + 1,
    "fitted-index": 0,
    "tyre-set-key": "",
    "tyre-set-data": {
      "actual-tyre-compound": "Soft",
      "visual-tyre-compound": "Soft",
      wear: 0,
      available: false,
      "recommended-session": "",
      "life-span": 0,
      "usable-life": 0,
      "lap-delta-time": 0,
      fitted: true,
    },
    "tyre-wear-history": Object.entries(wearByLap).map(([lap, wear]) => ({
      "lap-number": Number(lap),
      "front-left-wear": wear,
      "front-right-wear": wear / 2,
      "rear-left-wear": wear / 2,
      "rear-right-wear": wear / 2,
      average: wear,
      desc: "",
    })),
  };
}

function perLapInfo(lapCount: number, safetyCarLaps: number[]): PerLapInfo[] {
  return Array.from(
    { length: lapCount },
    (_, index) =>
      ({
        "lap-number": index + 1,
        "max-safety-car-status": safetyCarLaps.includes(index + 1)
          ? "FULL_SAFETY_CAR"
          : "NO_SAFETY_CAR",
      }) as PerLapInfo,
  );
}

const NO_NEUTRALISED_LAPS = new Set<number>();

test("a refitted used set's earlier wear stays out of its rate", () => {
  // Baku 23 Feb: the opening Hard went back on at 21.9% for laps 12-16.
  const stint = buildStint(12, 16, {
    11: 21.9,
    12: 26.1,
    13: 30.3,
    14: 34.5,
    15: 38.7,
    16: 42.9,
  });
  assert.ok(Math.abs(stintWearRate(stint, NO_NEUTRALISED_LAPS) - 4.2) < 1e-9);
});

test("an unfinished race's lap in progress does not dilute the rate", () => {
  // The final stint's end-lap is the lap being driven, which has no wear yet.
  const stint = buildStint(1, 5, { 0: 0, 1: 5, 2: 10, 3: 15, 4: 20 });
  assert.equal(stintWearRate(stint, NO_NEUTRALISED_LAPS), 5);
});

test("a pit-in lap logged without wear does not count as a lap", () => {
  // F2 Losail logs the pit-in lap at the previous lap's wear.
  const stint = buildStint(1, 5, { 0: 0, 1: 6, 2: 12, 3: 18, 4: 24, 5: 24 });
  assert.equal(stintWearRate(stint, NO_NEUTRALISED_LAPS), 6);
});

test("the session stint card reads the Safety Car stint like Tyre Life does", () => {
  // Sakhir 26 Oct: Soft fitted under the SC on lap 23, restart on lap 25.
  const stint = buildStint(23, 29, {
    22: 0,
    23: 1.02,
    24: 2.01,
    25: 7.18,
    26: 12.86,
    27: 19.09,
    28: 24.98,
    29: 32.55,
  });
  const [detail] = buildStintDetails(
    [stint],
    [],
    getNeutralisedLaps(perLapInfo(29, [23, 24, 25])),
  );
  assert.ok(detail);
  assert.equal(detail.peakWear, 32.55);
  assert.ok(Math.abs(detail.wearRate - 6.3425) < 1e-9);
  // Same projection as the Track page's Tyre Life card for this stint.
  assert.equal(detail.estimatedLife, 12);
});
