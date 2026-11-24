import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionLog, sessionLogOrder } from "../src/analysis/sessionLog";
import type { SessionSummary } from "../src/types/telemetry";

const save = (
  slug: string,
  track: string,
  date: string,
  isOnline = false,
): SessionSummary => ({
  relativePath: `${slug}.json`,
  slug,
  sessionType: "Race",
  track,
  date,
  validLapCount: 5,
  isOnline,
});

test("a day across several circuits lists each circuit's sessions under it, newest circuit first", () => {
  const sessions = [
    save("monza-practice", "Monza", "2026-11-24T21:00:00"),
    save("baku-online", "Baku", "2026-11-24T20:00:00", true),
    save("monza-online", "Monza", "2026-11-24T18:00:00", true),
    save("baku-practice", "Baku", "2026-11-24T22:00:00"),
    save("suzuka-practice", "Suzuka", "2026-11-23T10:00:00"),
  ];
  const [today, yesterday] = buildSessionLog(sessions);
  assert.deepEqual(
    today.tracks.map((track) => [
      track.track,
      track.groups.map((group) => group.sessions.map((s) => s.slug)),
    ]),
    [
      // Online event first within its circuit, even when practice came after.
      ["Baku", [["baku-online"], ["baku-practice"]]],
      ["Monza", [["monza-online"], ["monza-practice"]]],
    ],
  );
  assert.deepEqual(
    yesterday.tracks.map((track) => track.track),
    ["Suzuka"],
  );
  // ‹ › stepping follows the order the log shows.
  assert.deepEqual(
    sessionLogOrder([today, yesterday]).map((s) => s.slug),
    [
      "baku-online",
      "baku-practice",
      "monza-online",
      "monza-practice",
      "suzuka-practice",
    ],
  );
});
