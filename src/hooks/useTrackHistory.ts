import { useEffect, useState } from "react";
import { useSessionList } from "./useSessionList";
import { useTelemetry } from "../context/TelemetryContext";
import {
  findPlayer,
  getValidLaps,
  getCleanRaceLaps,
  getBestLapTime,
  isRaceSession,
} from "../utils/stats";
import { getFormulaKey } from "../utils/sessionTypes";

async function fetchTrackPbs(
  trackName: string,
  formula: string | undefined,
  excludeSlug: string | undefined,
): Promise<TrackPBs | null> {
  const params = new URLSearchParams({ track: trackName });
  if (formula) params.set("formula", formula);
  if (excludeSlug) params.set("exclude", excludeSlug);
  const res = await fetch(`/api/track-pbs?${params}`);
  if (!res.ok) return null;
  const d = await res.json();
  return {
    bestQualiLapMs: d.bestQualiLapMs ?? 0,
    bestS1Ms: d.bestS1Ms ?? 0,
    bestS2Ms: d.bestS2Ms ?? 0,
    bestS3Ms: d.bestS3Ms ?? 0,
    bestRaceLapMs: d.bestRaceLapMs ?? 0,
    bestRacePaceMs: d.bestRacePaceMs ?? 0,
    sessionCount: d.sessionCount ?? 0,
  };
}

export interface TrackPBs {
  /** All-time best qualifying lap time (ms) on this track */
  bestQualiLapMs: number;
  /** All-time best sector times (ms) across all qualifying sessions */
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  /** All-time best single race lap (ms) on this track */
  bestRaceLapMs: number;
  /** Best average race pace (ms) on this track */
  bestRacePaceMs: number;
  /** Number of previous sessions on this track (excluding current) */
  sessionCount: number;
}

/**
 * Load all sessions for the same track and compute all-time PBs.
 * Excludes the current session (by slug) so comparisons are always "vs history".
 */
export function useTrackHistory(
  trackName: string | undefined,
  currentSlug: string | undefined,
  formula: string | undefined,
): { pbs: TrackPBs | null; loading: boolean } {
  const { sessions } = useSessionList();
  const { getSession, mode } = useTelemetry();
  const [pbs, setPbs] = useState<TrackPBs | null>(null);
  const [loading, setLoading] = useState(true);

  const trackSessions = sessions.filter(
    (s) =>
      s.track === trackName &&
      s.slug !== currentSlug &&
      getFormulaKey(s.formula) === getFormulaKey(formula),
  );
  const trackSessionKey = trackSessions.map((s) => s.slug).join("|");

  useEffect(() => {
    if (!trackName) {
      setLoading(false);
      setPbs(null);
      return;
    }

    setLoading(true);

    if (mode === "api") {
      fetchTrackPbs(trackName, formula, currentSlug)
        .then((result) => {
          if (result !== null) {
            setPbs(result);
            setLoading(false);
            return;
          }
          // endpoint not available (e.g. Vite dev plugin) — fall through to per-session
          computeFromSessions();
        })
        .catch(() => computeFromSessions());
      return;
    }

    if (trackSessions.length === 0) {
      setLoading(false);
      setPbs(null);
      return;
    }

    computeFromSessions();

    function computeFromSessions() {
      if (trackSessions.length === 0) {
        setLoading(false);
        setPbs(null);
        return;
      }
      Promise.all(
        trackSessions.map(async (s) => {
          try {
            return await getSession(s.slug);
          } catch {
            return null;
          }
        }),
      ).then((results) => {
      const loaded = results.filter((r) => r !== null);

      let bestQualiLapMs = 0;
      let bestS1Ms = 0;
      let bestS2Ms = 0;
      let bestS3Ms = 0;
      let bestRaceLapMs = 0;
      let bestRacePaceMs = 0;

      for (const sessionData of loaded) {
        const player = findPlayer(sessionData);
        if (!player) continue;

        const laps = player["session-history"]["lap-history-data"];
        const valid = getValidLaps(laps);

        if (isRaceSession(sessionData)) {
          // Best single race lap
          const best = getBestLapTime(laps);
          if (best > 0 && (bestRaceLapMs === 0 || best < bestRaceLapMs)) {
            bestRaceLapMs = best;
          }
          // Best average race pace (clean laps — SC/pit/incident excluded)
          const clean = getCleanRaceLaps(player);
          if (clean.length > 0) {
            const avg =
              clean.reduce((s, l) => s + l["lap-time-in-ms"], 0) /
              clean.length;
            if (bestRacePaceMs === 0 || avg < bestRacePaceMs) {
              bestRacePaceMs = avg;
            }
          }
        } else {
          // Qualifying: best lap and sectors
          const best = getBestLapTime(laps);
          if (best > 0 && (bestQualiLapMs === 0 || best < bestQualiLapMs)) {
            bestQualiLapMs = best;
          }

          if (valid.length > 0) {
            const s1 = Math.min(
              ...valid
                .map((l) => l["sector-1-time-in-ms"])
                .filter((v) => v > 0),
            );
            const s2 = Math.min(
              ...valid
                .map((l) => l["sector-2-time-in-ms"])
                .filter((v) => v > 0),
            );
            const s3 = Math.min(
              ...valid
                .map((l) => l["sector-3-time-in-ms"])
                .filter((v) => v > 0),
            );

            if (s1 > 0 && (bestS1Ms === 0 || s1 < bestS1Ms)) bestS1Ms = s1;
            if (s2 > 0 && (bestS2Ms === 0 || s2 < bestS2Ms)) bestS2Ms = s2;
            if (s3 > 0 && (bestS3Ms === 0 || s3 < bestS3Ms)) bestS3Ms = s3;
          }
        }
      }

        setPbs({
          bestQualiLapMs,
          bestS1Ms,
          bestS2Ms,
          bestS3Ms,
          bestRaceLapMs,
          bestRacePaceMs,
          sessionCount: trackSessions.length,
        });
        setLoading(false);
      });
    }
  }, [trackName, formula, trackSessionKey, getSession, mode, currentSlug]);

  return { pbs, loading };
}
