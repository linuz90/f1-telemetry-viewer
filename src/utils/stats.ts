/**
 * Compatibility barrel for telemetry statistics.
 *
 * The implementation is split by domain under `src/utils/stats/` so analysis
 * modules can depend on focused helpers without re-growing a monolithic utility
 * file. Existing callers can keep importing from `../utils/stats` while new
 * code should prefer the domain module that owns the calculation.
 */
export * from "./stats/core";
export * from "./stats/drivers";
export * from "./stats/energy";
export * from "./stats/insightTypes";
export * from "./stats/laps";
export * from "./stats/pace";
export * from "./stats/sessionInsights";
export * from "./stats/track";
export * from "./stats/tyres";
