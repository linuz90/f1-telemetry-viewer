/** Summary returned by GET /api/sessions */
export interface SessionSummary {
  relativePath: string;
  slug: string;
  sessionType: string;
  track: string;
  date: string;
  validLapCount: number;
  lapIndicators?: ("valid" | "invalid" | "best")[];
  bestLapTime?: string;
  bestLapTimeMs?: number;
  aiDifficulty?: number;
  isSpectator?: boolean;
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
  "ers-deployed-this-lap"?: number;
  "ers-max-capacity"?: number;
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
  "max-safety-car-status": string;
  "track-position"?: number;
  "top-speed-kmph"?: number;
}
