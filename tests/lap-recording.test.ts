import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLapRecordingIndex,
  resolveLapRecordingRequest,
} from "../src/plugin/lap-recording-index";
import {
  buildRecordingPairing,
  openLapRecording,
  parseLapTrace,
  recordingPairKey,
} from "../src/utils/lapRecording/reader";
import type {
  LapRecordingManifest,
  LapRecordingSummary,
} from "../src/utils/lapRecording/types";
import { range, syntheticLap } from "../src/utils/lapRecording/syntheticLap";
import { buildPngt } from "./lapRecordingFixtures";

const TRACK_LENGTH = 4000;
const fullLap = syntheticLap({
  trackLengthM: TRACK_LENGTH,
  corners: [{ apex: 1000, minKmh: 120 }],
});

function withDistance(distance: number[]) {
  return { ...fullLap.channels, lap_distance: distance };
}

test("completeness comes from distance coverage, never the exporter's is_good", async () => {
  const bytes = await buildPngt({
    drivers: [
      {
        index: 21,
        name: "RUSSELL",
        laps: [
          {
            lapNumber: 1,
            lapTimeMs: fullLap.lapTimeMs,
            channels: fullLap.channels,
          },
          // Flagged good by the exporter but recorded from 3,430 m only.
          {
            lapNumber: 2,
            lapTimeMs: 76_822,
            isGood: true,
            channels: withDistance([-5, ...range(3430, TRACK_LENGTH - 1, 2)]),
          },
          {
            lapNumber: 3,
            lapTimeMs: 77_000,
            channels: withDistance([
              ...range(1, 1500, 2),
              ...range(1560, TRACK_LENGTH - 1, 2),
            ]),
          },
          { lapNumber: 4, lapTimeMs: null, channels: fullLap.channels },
          // One Shot Qualifying stub: ten samples before the line, then nothing.
          {
            lapNumber: 5,
            lapTimeMs: 81_000,
            channels: withDistance(range(-100, -10, 10)),
          },
        ],
      },
    ],
  });
  const { manifest } = await openLapRecording(bytes, {
    fileName: "Short_Qualifying_Melbourne_2026_10_05_20_49_14.pngt",
    pairing: { sessionSlug: "x", trackLengthM: TRACK_LENGTH },
  });
  const laps = manifest.drivers[0].laps;
  assert.deepEqual(
    laps.map((lap) => [lap.lapNumber, lap.complete, lap.incompleteReason]),
    [
      [1, true, undefined],
      [2, false, "last 570 m only"],
      [3, false, "60 m gap in the trace"],
      [4, false, "no lap time"],
      [5, false, "not recorded past the line"],
    ],
  );
});

test("recordings keep the 64-bit session UID and reject unknown format versions", async () => {
  const drivers = [{ index: 0, name: "OCON", laps: [] }];
  const { manifest } = await openLapRecording(
    await buildPngt({ sessionUid: "14519567076918017992", drivers }),
    { fileName: "Race_Melbourne_2026_10_05_17_00_04.pngt" },
  );
  assert.equal(manifest.sessionUid, "14519567076918017992");
  assert.equal(manifest.slug, "race-melbourne-2026-10-05-17-00-04");

  await assert.rejects(
    openLapRecording(await buildPngt({ version: 2, drivers }), {
      fileName: "x.pngt",
    }),
    /Unsupported lap recording format pngt v2/,
  );
});

test("a recording pairs with its Just_in_case session JSON", () => {
  assert.equal(
    recordingPairKey("Short_Qualifying_Melbourne_2026_10_05_20_49_14.pngt"),
    recordingPairKey(
      "race-info/Short_Qualifying_Melbourne_Just_in_case_2026_10_05_20_49_14.json",
    ),
  );
  const pairing = buildRecordingPairing(
    "Short_Qualifying_Melbourne_Just_in_case_2026_10_05_20_49_14.json",
    {
      "session-info": {
        "track-length": 5276,
        // Beta exports write sector starts as strings.
        "sector-2-lap-distance-start": "1757.05",
        "sector-3-lap-distance-start": "3178.6",
        weather: "Clear",
      },
      "classification-data": [
        { index: 3, "is-player": false },
        { index: 21, "is-player": true },
      ],
    },
  );
  assert.deepEqual(pairing, {
    sessionSlug: "short-qualifying-melbourne-just-in-case-2026-10-05-20-49-14",
    playerIndex: 21,
    trackLengthM: 5276,
    sectorStartsM: [1757.05, 3178.6],
    weather: "Clear",
  });
});

test("the API lists, describes and serves recorded laps from a telemetry folder", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "lap-recording-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const day = path.join(root, "2026_10_05");
  await mkdir(path.join(day, "telemetry"), { recursive: true });
  await mkdir(path.join(day, "race-info"), { recursive: true });
  await writeFile(
    path.join(
      day,
      "telemetry",
      "Short_Qualifying_Melbourne_2026_10_05_20_49_14.pngt",
    ),
    await buildPngt({
      drivers: [
        {
          index: 3,
          name: "OCON",
          team: "Haas '26",
          laps: [
            {
              lapNumber: 1,
              lapTimeMs: fullLap.lapTimeMs + 500,
              channels: fullLap.channels,
            },
          ],
        },
        {
          index: 21,
          name: "RUSSELL",
          laps: [
            {
              lapNumber: 1,
              lapTimeMs: fullLap.lapTimeMs,
              channels: fullLap.channels,
            },
          ],
        },
      ],
    }),
  );
  await writeFile(
    path.join(
      day,
      "race-info",
      "Short_Qualifying_Melbourne_Just_in_case_2026_10_05_20_49_14.json",
    ),
    JSON.stringify({
      "session-info": { "track-length": TRACK_LENGTH },
      "classification-data": [{ index: 21, "is-player": true }],
    }),
  );
  const index = createLapRecordingIndex({
    telemetryDir: root,
    logger: { info() {}, warn() {} },
  });

  const list = await resolveLapRecordingRequest("/api/lap-recordings", index);
  const [summary] = JSON.parse(list.body as string) as LapRecordingSummary[];
  assert.equal(
    summary.sessionSlug,
    "short-qualifying-melbourne-just-in-case-2026-10-05-20-49-14",
  );
  assert.equal(summary.playerIndex, 21);
  assert.equal(summary.completeLapCount, 2);
  assert.deepEqual(
    summary.drivers.map((driver) => [driver.name, driver.best?.lapTimeMs]),
    [
      ["OCON", fullLap.lapTimeMs + 500],
      ["RUSSELL", fullLap.lapTimeMs],
    ],
  );

  const manifest = await resolveLapRecordingRequest(
    `/api/lap-recordings/${summary.slug}`,
    index,
  );
  assert.equal(
    (JSON.parse(manifest.body as string) as LapRecordingManifest).trackLengthM,
    TRACK_LENGTH,
  );

  const lap = await resolveLapRecordingRequest(
    `/api/lap-recordings/${summary.slug}/21/1`,
    index,
  );
  assert.equal(lap.contentType, "application/octet-stream");
  const trace = await parseLapTrace(lap.body as Uint8Array);
  assert.equal(
    trace.lap_distance?.length,
    fullLap.channels.lap_distance.length,
  );

  for (const missing of [
    `/api/lap-recordings/${summary.slug}/21/9`,
    `/api/lap-recordings/${summary.slug}/21`,
    // Number() would read these as driver 21, lap 1.
    `/api/lap-recordings/${summary.slug}/0x15/1`,
    `/api/lap-recordings/${summary.slug}/21/1e0`,
    "/api/lap-recordings/..%2Fsecret",
    "/api/lap-recordings/no-such-recording",
  ]) {
    assert.equal(
      (await resolveLapRecordingRequest(missing, index)).status,
      404,
      missing,
    );
  }
});
