import type { TelemetrySession } from "../types/telemetry";
import { msToSectorTime } from "../utils/format";
import { getValidLaps, findPlayer } from "../utils/stats";
import { getTeamColor } from "../utils/colors";

interface SectorVsBestProps {
  session: TelemetrySession;
}

const SECTOR_KEYS = [
  { key: "sector-1-time-in-ms", label: "S1" },
  { key: "sector-2-time-in-ms", label: "S2" },
  { key: "sector-3-time-in-ms", label: "S3" },
] as const;

/**
 * Compares the player's best sector times against the session-best sectors,
 * showing deltas and who holds the best in each sector.
 */
export function SectorVsBest({ session }: SectorVsBestProps) {
  const player = findPlayer(session);
  if (!player) return null;

  const drivers = session["classification-data"];

  // Compute session-best and player-best for each sector
  const sectors = SECTOR_KEYS.map(({ key, label }) => {
    // Player best
    const playerValid = getValidLaps(
      player["session-history"]["lap-history-data"],
    );
    const playerBest = playerValid.length
      ? Math.min(...playerValid.map((l) => l[key]))
      : null;

    // Session best across all drivers
    let sessionBest = Infinity;
    let sessionBestDriver = "";
    let sessionBestTeam = "";

    for (const d of drivers) {
      const valid = getValidLaps(d["session-history"]["lap-history-data"]);
      for (const lap of valid) {
        if (lap[key] < sessionBest) {
          sessionBest = lap[key];
          sessionBestDriver = d["driver-name"];
          sessionBestTeam = d.team;
        }
      }
    }

    if (sessionBest === Infinity) sessionBest = 0;

    const isPlayerBest =
      playerBest !== null &&
      sessionBest > 0 &&
      Math.abs(playerBest - sessionBest) < 1;
    const deltaMs =
      playerBest !== null && sessionBest > 0 ? playerBest - sessionBest : null;

    return {
      label,
      playerBest,
      sessionBest,
      sessionBestDriver,
      sessionBestTeam,
      isPlayerBest,
      deltaMs,
    };
  });

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-300 mb-3">
        Your Sectors vs Best
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {sectors.map((s) => (
          <div
            key={s.label}
            className={`rounded-lg px-3 py-3 ${
              s.isPlayerBest
                ? "bg-purple-500/10 border border-purple-500/30"
                : "bg-zinc-900/50"
            }`}
          >
            <div className="text-xs uppercase text-zinc-500 mb-2">
              {s.label}
            </div>

            {/* Player time */}
            <div className="font-mono text-lg font-semibold text-zinc-100">
              {s.playerBest !== null ? msToSectorTime(s.playerBest) : "–"}
            </div>

            {/* Delta */}
            {s.deltaMs !== null && (
              <div
                className={`font-mono text-sm mt-0.5 ${
                  s.isPlayerBest
                    ? "text-purple-400"
                    : s.deltaMs < 100
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {s.isPlayerBest
                  ? "Session best"
                  : `+${(s.deltaMs / 1000).toFixed(3)}`}
              </div>
            )}

            {/* Session best holder */}
            {!s.isPlayerBest && s.sessionBest > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: getTeamColor(s.sessionBestTeam) }}
                />
                <span className="truncate">
                  {s.sessionBestDriver}{" "}
                  <span className="font-mono">
                    {msToSectorTime(s.sessionBest)}
                  </span>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
