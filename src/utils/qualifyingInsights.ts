/**
 * Track-page "Qualifying Insights" model — mirrors the synthesis the Race tab
 * does via `buildTrackRaceRecommendation()`, but for qualifying. Aggregates per-
 * session signals (player best lap, sector bests, pole time of the session) into
 * the headline numbers the `TrackQualifyingInsights` component renders.
 *
 * Online vs offline matters here because they are different opponents and
 * different goals: offline AI laps are the player's clean-lap ceiling, online
 * laps are the lap that has to beat a real human grid. Splitting the best-lap
 * tiles keeps those signals from masking each other.
 *
 * What we DON'T have: the per-driver roster on online quali sessions (CLAUDE.md
 * notes the roster is race-only). So `fastestOnlinePole` carries a *time* and a
 * pole-share, never a rival name — the UI is honest about that.
 */
export interface QualifyingSessionForInsights {
  /** Player's best valid lap in this session, in ms. 0 when missing. */
  bestLapMs: number;
  /** Player's best sector times in this session, in ms. 0 when missing. */
  bestS1: number;
  bestS2: number;
  bestS3: number;
  /** ISO session date — used to pick "latest" and "previous". */
  date: string;
  /** True when the session was an online lobby. Undefined treated as offline. */
  isOnline?: boolean;
  /** Fastest valid lap of the qualifying session as recorded in the JSON. */
  poleLapTimeMs?: number;
  /** Player's classification position in this quali (1 = pole). */
  qualifyingPosition?: number;
}

export interface TrackQualifyingBest {
  bestLapMs: number;
  sessionCount: number;
  /** Pole count for the player within this bucket — used by online tile sub-line. */
  polesByPlayer: number;
}

export interface TrackQualifyingPoleBenchmark {
  /** Fastest pole time recorded across online quali sessions at this track. */
  poleLapMs: number;
  /**
   * Delta vs. the player's best online lap. Negative = pole beat the player.
   * 0 when the player matched (or when no online lap exists to compare against).
   */
  deltaVsPlayerMs: number;
  /** Online quali sessions at this track (denominator for the pole-share line). */
  onlineSessionCount: number;
  /** Online quali sessions where another driver out-qualified the player. */
  beatenSessionCount: number;
  /** True when the player set every online pole here. */
  playerSweptPoles: boolean;
}

export interface TrackQualifyingSinceLast {
  /** Latest quali best − previous quali best (ms). Negative = faster. */
  bestLapDeltaMs: number;
}

export interface TrackQualifyingInsights {
  /** Total quali sessions feeding the section (online + offline). */
  qualiCount: number;
  onlineCount: number;
  offlineCount: number;
  /** Overall best across all qualis — fallback when only one of online/offline exists. */
  overall: TrackQualifyingBest;
  /** Player's best in online qualis. Null when there are no online qualis. */
  online: TrackQualifyingBest | null;
  /** Player's best in offline qualis. Null when there are no offline qualis. */
  offline: TrackQualifyingBest | null;
  /** Sum of all-time best S1/S2/S3 across the sessions, in ms. 0 if any sector missing. */
  theoreticalBestMs: number;
  /** Overall best lap − theoretical best. Always ≥ 0 by construction. */
  gapToTheoreticalMs: number;
  /** Fastest online pole here and how it stacks against the player. Null offline-only. */
  fastestOnlinePole: TrackQualifyingPoleBenchmark | null;
  /** Best-lap delta between the latest and previous quali at this track. */
  sinceLastQuali: TrackQualifyingSinceLast | null;
}

function minPositive(values: number[]): number {
  let best = 0;
  for (const v of values) {
    if (v > 0 && (best === 0 || v < best)) best = v;
  }
  return best;
}

function buildBucketBest(
  bucket: QualifyingSessionForInsights[],
): TrackQualifyingBest {
  const bestLapMs = minPositive(bucket.map((s) => s.bestLapMs));
  const polesByPlayer = bucket.reduce(
    (acc, s) => acc + (s.qualifyingPosition === 1 ? 1 : 0),
    0,
  );
  return { bestLapMs, sessionCount: bucket.length, polesByPlayer };
}

export function buildTrackQualifyingInsights(
  sessions: QualifyingSessionForInsights[],
): TrackQualifyingInsights | null {
  if (sessions.length === 0) return null;

  // Date-sort defensively — caller already does it for the chart pipelines,
  // but the "since last quali" tile relies on this order.
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const onlineBucket = sorted.filter((s) => s.isOnline === true);
  const offlineBucket = sorted.filter((s) => s.isOnline !== true);

  const overall = buildBucketBest(sorted);
  const online = onlineBucket.length > 0 ? buildBucketBest(onlineBucket) : null;
  const offline =
    offlineBucket.length > 0 ? buildBucketBest(offlineBucket) : null;

  const theoreticalBestS1 = minPositive(sorted.map((s) => s.bestS1));
  const theoreticalBestS2 = minPositive(sorted.map((s) => s.bestS2));
  const theoreticalBestS3 = minPositive(sorted.map((s) => s.bestS3));
  const theoreticalBestMs =
    theoreticalBestS1 > 0 && theoreticalBestS2 > 0 && theoreticalBestS3 > 0
      ? theoreticalBestS1 + theoreticalBestS2 + theoreticalBestS3
      : 0;
  const gapToTheoreticalMs =
    overall.bestLapMs > 0 && theoreticalBestMs > 0
      ? Math.max(0, overall.bestLapMs - theoreticalBestMs)
      : 0;

  // Fastest online pole = best `poleLapTimeMs` across online qualis. Compared
  // against the player's best ONLINE lap (not the overall best), because the
  // offline best is a different opponent set and mixing them would make the
  // delta meaningless.
  let fastestOnlinePole: TrackQualifyingPoleBenchmark | null = null;
  if (onlineBucket.length > 0) {
    const polePool = onlineBucket
      .map((s) => s.poleLapTimeMs ?? 0)
      .filter((v) => v > 0);
    const bestPoleMs = minPositive(polePool);
    if (bestPoleMs > 0) {
      const playerBestOnlineMs = online?.bestLapMs ?? 0;
      const deltaVsPlayerMs =
        playerBestOnlineMs > 0 ? bestPoleMs - playerBestOnlineMs : 0;
      const beatenSessionCount = onlineBucket.reduce(
        (acc, s) =>
          acc + (s.qualifyingPosition != null && s.qualifyingPosition > 1 ? 1 : 0),
        0,
      );
      const playerSweptPoles =
        online != null && online.polesByPlayer === online.sessionCount;
      fastestOnlinePole = {
        poleLapMs: bestPoleMs,
        deltaVsPlayerMs,
        onlineSessionCount: onlineBucket.length,
        beatenSessionCount,
        playerSweptPoles,
      };
    }
  }

  // Since last quali: latest vs previous, anywhere on the track (online or
  // offline — like the Race tab's vs-last-race tile, which is also formula-
  // scoped but not separated by competition kind).
  let sinceLastQuali: TrackQualifyingSinceLast | null = null;
  if (sorted.length >= 2) {
    const latest = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];
    if (latest.bestLapMs > 0 && previous.bestLapMs > 0) {
      sinceLastQuali = {
        bestLapDeltaMs: latest.bestLapMs - previous.bestLapMs,
      };
    }
  }

  return {
    qualiCount: sorted.length,
    onlineCount: onlineBucket.length,
    offlineCount: offlineBucket.length,
    overall,
    online,
    offline,
    theoreticalBestMs,
    gapToTheoreticalMs,
    fastestOnlinePole,
    sinceLastQuali,
  };
}
