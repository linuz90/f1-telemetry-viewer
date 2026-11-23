import assert from "node:assert/strict";
import test from "node:test";
import { sessionConditions } from "../src/analysis/trackSetups";
import type { TelemetrySession } from "../src/types/telemetry";

/** A save whose player ran `compounds`, one lap each, under `weather`. */
function save(weather: string, compounds: string[]): TelemetrySession {
  return {
    "session-info": { weather },
    "classification-data": [
      {
        "is-player": true,
        "tyre-set-history": [],
        "per-lap-info": compounds.map((c) => ({
          "car-status-data": { "visual-tyre-compound": c },
        })),
      },
    ],
  } as unknown as TelemetrySession;
}

test("sessionConditions trusts wet tyres over the weather at save time", () => {
  // Montreal, Nov 2026: a race on Inters saved after the rain stopped.
  assert.equal(sessionConditions(save("Clear", ["Inters", "Inters"])), "wet");
  assert.equal(sessionConditions(save("Light Rain", ["Soft"])), "wet");
  assert.equal(sessionConditions(save("Clear", ["Medium", "Hard"])), "dry");
});
