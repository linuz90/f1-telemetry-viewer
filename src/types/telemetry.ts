/** Summary returned by GET /api/sessions */
export interface SessionSummary {
  relativePath: string;
  slug: string;
  sessionType: string;
  track: string;
  formula?: string;
  gameYear?: number;
  packetFormat?: number;
  date: string;
  validLapCount: number;
  lapIndicators?: ("valid" | "invalid" | "best")[];
  bestLapTime?: string;
  bestLapTimeMs?: number;
  aiDifficulty?: number;
  isOnline?: boolean;
  isSpectator?: boolean;
  classifiedDriverCount?: number;
  onlineDriverCount?: number;
  activeHumanDriverCount?: number;
  /** session-info.weather string when available (e.g. "Clear", "Light Rain", "Heavy Rain") */
  weather?: string;
  /** True when the player set the session's fastest lap (records.fastest.lap driver index match) */
  playerSetFastestLap?: boolean;
  /** Player's track position at the end of lap 1 (per-lap-info[0]["track-position"]). Race sessions only. */
  lapOnePosition?: number;
  /** Player's rank in the speed-trap table (1 = fastest). Race sessions only. */
  topSpeedTrapRank?: number;
  /** Number of drivers in the speed-trap table — denominator for topSpeedTrapRank. */
  topSpeedTrapTotal?: number;
  /** Player's tyre stints (one entry per stint) — race sessions only. */
  stints?: PlayerStintSummary[];
  /** Whether the player owns the purple sector in S1/S2/S3 for this session. */
  purpleSectors?: { s1: boolean; s2: boolean; s3: boolean };
  /** Overtakes the player completed on track (from overtakes.records). */
  overtakesMade?: number;
  /** Overtakes against the player on track. */
  overtakesTaken?: number;
  /** Player's team identifier for this session (raw value from JSON — Ferrari, "211", etc.). */
  playerTeam?: string;
  /** Per-driver lap stats for the player (mean + stddev of valid laps) — race sessions only. */
  playerLapStats?: { meanLapMs: number; stddevLapMs: number; validLapCount: number };
  /**
   * Slim roster of non-player drivers from this race, used by the Rivals & Teammates
   * section. Only emitted for online race sessions. See {@link RivalEntry}.
   */
  rivals?: RivalEntry[];
  playerRaceResult?: PlayerRaceResult;
  fileSize?: number;
  duplicateCount?: number;
  /**
   * True when the save was produced by Pits n' Giggles' periodic
   * "just-in-case" auto-save (detected from the filename). Used for the
   * dominance-based dedup rule and to render an "Auto-save" badge in the
   * session list. See `src/utils/deduplicateSessions.ts`.
   */
  isAutoSave?: boolean;
  /**
   * True for demo-only summary entries that have no backing detail JSON.
   * Used to enrich the prod (no-data) dashboard with realistic Rivals &
   * Teammates aggregates. UI surfaces that can navigate to a detail page
   * must either render these as static demo rows or route to the demo
   * placeholder state in `SessionPage`.
   */
  isSynthetic?: boolean;
}

export interface PlayerStintSummary {
  /** Visual compound name (Soft, Medium, Hard, Intermediate, Wet). */
  compound: string;
  laps: number;
  /** Average tyre wear percentage at the end of the stint (0-100). */
  endWearAvg: number;
}

/**
 * One non-player driver from a race, with the per-race signals the dashboard's
 * Rivals & Teammates cards aggregate over. Identity key is the normalized driver
 * name — the only stable handle across sessions; `driver-id` and `network-id`
 * reset each session.
 */
export interface RivalEntry {
  /** Normalized driver-name (trim + lowercase) — stable identity across sessions. */
  key: string;
  /** Display name (raw `driver-name`). */
  name: string;
  /** Raw team identifier — string brand ("Ferrari") in F1, numeric ID ("211") in F2. */
  team?: string;
  /** True when the driver shares the player's team in this session. */
  isTeammate: boolean;
  /** Final classification position, when present. */
  position?: number;
  /** Grid (starting) position from final-classification. */
  gridPosition?: number;
  /** result-status from final-classification (FINISHED, DNF, etc.). */
  status?: string;
  /** Number of penalties accumulated in this race. */
  penaltyCount?: number;
  /** Best valid lap time (ms) for this driver in this race. */
  bestLapMs?: number;
  /** Count of valid laps (lap-time>0, lap-valid-bit-flags=15). */
  validLapCount: number;
  /** Mean valid lap time (ms). */
  meanLapMs?: number;
  /** Std-deviation of valid lap times (ms). */
  stddevLapMs?: number;
  /** Times this driver overtook anyone on track (overtakes.records). */
  overtakes: number;
  /** Times this driver overtook the player. */
  overtakesOnPlayer: number;
  /** Times the player overtook this driver. */
  overtakesByPlayer: number;
  /** Mean per-lap absolute position gap to the player across the race. */
  avgPositionGap?: number;
  /** Count of laps both drivers were on the same lap number for the gap calculation. */
  positionGapSamples?: number;
  /** True when this driver set the overall fastest valid lap of the race. */
  hadFastestLap?: boolean;
  /**
   * True when the slot was filled by an AI driver — typically real F1/F2
   * surnames like VERSTAPPEN or ANTONELLI that the game inserts for empty
   * lobby seats (or for players whose telemetry isn't published). Used by
   * the dashboard's rivals aggregation to keep the leaderboards focused on
   * actual humans the player has raced. Undefined for older exports that
   * predate the participant-data capture.
   */
  isAi?: boolean;
}

export interface PlayerRaceResult {
  position: number;
  gridPosition?: number;
  status?: string;
  points?: number;
  penaltiesTime?: number;
  penaltyCount?: number;
  playerLaps: number;
  totalLaps?: number;
  lapRatio?: number;
  fieldSize: number;
  bestLapTime?: string;
  bestLapTimeMs?: number;
}

// --- Full session JSON types ---

export interface TelemetrySession {
  "session-info": SessionInfo;
  "classification-data": DriverData[];
  "position-history": PositionHistoryEntry[];
  "speed-trap-records": SpeedTrapRecord[];
  "tyre-stint-history-v2": TyreStintHistoryV2Entry[];
  records: Records;
  overtakes: { records: OvertakeRecord[] };
  debug: DebugInfo;
  "game-year": number;
  "packet-format"?: number;
  version: string;
}

export interface SessionInfo {
  "session-type": string;
  "track-id": string;
  weather: string;
  "track-temperature": number;
  "air-temperature": number;
  "total-laps": number;
  "track-length": number;
  "pit-speed-limit": number;
  "safety-car-status": string;
  "game-mode": string;
  "ai-difficulty": number;
  "network-game"?: number;
  formula: string;
  "gearbox-assist": string;
  "weather-forecast-samples"?: WeatherForecastSample[];
  "active-aero-track-status"?: string;
  "num-active-aero-zones-full"?: number;
  "active-aero-zones-full"?: unknown[];
  "num-active-aero-zones-partial"?: number;
  "active-aero-zones-partial"?: unknown[];
  "num-drs-zones"?: number;
  "drs-zones"?: unknown[];
  "start-reaction-time"?: number;
  "anti-lock-brakes-assist"?: number;
  "traction-control-assist"?: string | number;
  "dynamic-racing-line-hi-vis"?: number;
  "dynamic-racing-line-colour-blind"?: string | number;
  "recurring-rewind-prompt"?: number;
}

export interface WeatherForecastSample {
  "time-offset": number;
  weather: string;
  "track-temperature": number;
  "air-temperature": number;
  "rain-percentage": number;
}

export interface CarSetup {
  "front-wing": number;
  "rear-wing": number;
  "on-throttle": number;
  "off-throttle": number;
  "front-camber": number;
  "rear-camber": number;
  "front-toe": number;
  "rear-toe": number;
  "front-suspension": number;
  "rear-suspension": number;
  "front-anti-roll-bar": number;
  "rear-anti-roll-bar": number;
  "front-suspension-height": number;
  "rear-suspension-height": number;
  "brake-pressure": number;
  "brake-bias": number;
  "engine-braking": number;
  "rear-left-tyre-pressure": number;
  "rear-right-tyre-pressure": number;
  "front-left-tyre-pressure": number;
  "front-right-tyre-pressure": number;
  "ballast": number;
  "fuel-load": number;
  "is-valid": boolean;
}

export interface DriverData {
  index: number;
  "is-player": boolean;
  "driver-name": string;
  "track-position": number;
  team: string;
  "participant-data"?: ParticipantData;
  "current-lap": number;
  "top-speed-kmph": number;
  "car-damage": CarDamage;
  "car-status": CarStatus;
  "session-history": SessionHistory;
  "final-classification": FinalClassification | null;
  "lap-data": LapDataCurrent;
  "tyre-set-history": TyreStint[];
  "per-lap-info": PerLapInfo[];
  "car-setup"?: CarSetup | null;
}

export interface ParticipantData {
  "ai-controlled"?: boolean;
  "driver-id"?: number;
  "network-id"?: number;
  "team-id"?: string;
  "my-team"?: boolean;
  "race-number"?: number;
  nationality?: string;
  name?: string;
  "telemetry-setting"?: string;
  "show-online-names"?: boolean;
  "tech-level"?: number;
  platform?: string;
}

export interface SessionHistory {
  "num-laps": number;
  "num-tyre-stints": number;
  "best-lap-time-lap-num": number;
  "best-sector-1-lap-num": number;
  "best-sector-2-lap-num": number;
  "best-sector-3-lap-num": number;
  "lap-history-data": LapHistoryEntry[];
  "tyre-stints-history-data": TyreStintBasic[];
}

export interface LapHistoryEntry {
  "lap-time-in-ms": number;
  "lap-time-str": string;
  "sector-1-time-in-ms": number;
  "sector-1-time-str": string;
  "sector-2-time-in-ms": number;
  "sector-2-time-str": string;
  "sector-3-time-in-ms": number;
  "sector-3-time-str": string;
  "lap-valid-bit-flags": number;
}

export interface TyreStintBasic {
  "tyre-actual-compound": string;
  "tyre-visual-compound": string;
  "end-lap": number;
}

export interface TyreStint {
  "start-lap": number;
  "end-lap": number;
  "stint-length": number;
  "fitted-index": number;
  "tyre-set-key": string;
  "tyre-set-data": TyreSetData;
  "tyre-wear-history": TyreWearEntry[];
}

export interface TyreSetData {
  "actual-tyre-compound": string;
  "visual-tyre-compound": string;
  wear: number;
  available: boolean;
  "recommended-session": string;
  "life-span": number;
  "usable-life": number;
  "lap-delta-time": number;
  fitted: boolean;
}

export interface TyreWearEntry {
  "lap-number": number;
  "front-left-wear": number;
  "front-right-wear": number;
  "rear-left-wear": number;
  "rear-right-wear": number;
  average: number;
  desc: string;
}

export interface CarDamage {
  "tyres-wear": number[];
  "tyres-damage": number[];
  "front-left-wing-damage": number;
  "front-right-wing-damage": number;
  "rear-wing-damage": number;
  "floor-damage": number;
  "diffuser-damage": number;
  "sidepod-damage": number;
  "engine-damage"?: number;
  "gear-box-damage"?: number;
  "drs-fault"?: boolean;
  "ers-fault"?: boolean;
  "engine-blown"?: boolean;
  "engine-seized"?: boolean;
}

export interface CarStatus {
  "actual-tyre-compound": string;
  "visual-tyre-compound": string;
  "tyres-age-laps": number;
  "fuel-in-tank": number;
  "fuel-remaining-laps": number;
  "fuel-capacity"?: number;
  "engine-power-ice": number;
  "engine-power-mguk"?: number;
  "ers-store-energy"?: number;
  "ers-deploy-mode"?: string;
  "ers-harvested-this-lap-mguk"?: number;
  "ers-harvested-this-lap-mguh"?: number;
  "ers-harvested-limit-per-lap"?: number;
  "ers-deployed-this-lap"?: number;
  "ers-max-capacity"?: number;
}

export interface ErsStats {
  "ers-deployed-j"?: number;
  "ers-harv-mguk-j"?: number;
  "ers-harv-mguh-j"?: number;
}

export interface LapDataCurrent {
  "current-lap-time-in-ms": number;
  "current-lap-time-str": string;
  "last-lap-time-in-ms": number;
  "last-lap-time-str": string;
  "sector-1-time-in-ms": number;
  "sector-2-time-in-ms": number;
  "delta-to-car-in-front-in-ms": number;
  "delta-to-race-leader-in-ms": number;
  "current-lap-num": number;
  "pit-status": string;
  "driver-status": string;
}

export interface FinalClassification {
  position: number;
  "num-laps": number;
  "grid-position": number;
  points: number;
  "num-pit-stops": number;
  "result-status": string;
  "best-lap-time-in-ms": number;
  "best-lap-time-ms"?: number;
  "best-lap-time-str": string;
  "total-race-time": number;
  "total-race-time-str": string;
  "penalties-time": number;
  "num-penalties": number;
  "num-tyre-stints": number;
}

export interface PositionHistoryEntry {
  name: string;
  team: string;
  "driver-number": number;
  "driver-position-history": { "lap-number": number; position: number }[];
}

export interface SpeedTrapRecord {
  name: string;
  team: string;
  "driver-number": number;
  "speed-trap-record-kmph": number;
}

export interface TyreStintHistoryV2Entry {
  name: string;
  team: string;
  index?: number;
  position: number;
  "grid-position": number;
  "delta-to-leader": number | string | null;
  "race-time": string | null;
  "result-status": string;
  "tyre-stint-history": TyreStint[];
}

export interface Records {
  fastest: {
    lap: RecordEntry;
    s1: RecordEntry;
    s2: RecordEntry;
    s3: RecordEntry;
  };
}

export interface RecordEntry {
  "driver-index": number;
  "lap-number": number;
  "driver-name": string;
  "team-id": string;
  /** Time in ms — field name is "time" in the JSON */
  time: number | null;
  "time-str": string;
}

export interface OvertakeRecord {
  "overtaking-driver-name": string;
  "overtaken-driver-name": string;
  "overtaking-driver-lap": number;
}

export interface DebugInfo {
  "session-uid": number;
  timestamp: string;
  timezone: string;
  reason: string;
  "packet-count": number;
  "file-name": string;
}

export interface PerLapInfo {
  "lap-number": number;
  "car-damage-data": CarDamage;
  "car-status-data": CarStatus;
  "ers-stats"?: ErsStats;
  "max-safety-car-status": string;
  "track-position"?: number;
  "top-speed-kmph"?: number;
}
