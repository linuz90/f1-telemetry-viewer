/**
 * Your earlier bests at a track, as session pages compare against them
 * (computed by `useTrackHistory()` from sessions before the current one).
 */
export interface TrackPBs {
  /** Best qualifying lap (ms) on this track; Time Trial is kept separate. */
  bestQualiLapMs: number;
  /** Best sector times (ms) across qualifying sessions, Time Trial excluded. */
  bestS1Ms: number;
  bestS2Ms: number;
  bestS3Ms: number;
  /** All-time Time Trial lap and sector PBs, kept separate from qualifying. */
  bestTimeTrialLapMs: number;
  bestTimeTrialS1Ms: number;
  bestTimeTrialS2Ms: number;
  bestTimeTrialS3Ms: number;
  /** Number of previous Time Trial sessions on this track/formula. */
  timeTrialSessionCount: number;
  /** All-time best single race lap (ms) on this track */
  bestRaceLapMs: number;
  /** Best evidence-qualified average race pace (ms) at the same race distance. */
  bestRacePaceMs: number;
  /** Number of earlier sessions on this track. */
  sessionCount: number;
}
