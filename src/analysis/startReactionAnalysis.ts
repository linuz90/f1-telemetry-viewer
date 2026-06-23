import type { DriverData, TelemetrySession } from "../types/telemetry";
import { isRaceSession } from "../utils/sessionTypes";

const MAX_VALID_REACTION_SECONDS = 5;

export const START_REACTION_RAIL_TICKS = [0, 0.1, 0.2, 0.3, 0.4, 0.5] as const;
export const START_REACTION_RAIL_MAX_SECONDS =
  START_REACTION_RAIL_TICKS[START_REACTION_RAIL_TICKS.length - 1]!;

export type StartReactionRating =
  | "exceptional"
  | "optimal"
  | "good"
  | "bad"
  | "terrible";

export interface StartReactionModel {
  seconds: number;
  formatted: string;
  markerPct: number;
  isDisplayClamped: boolean;
  rating: StartReactionRating;
  label: string;
  detail: string;
}

export function formatStartReactionTime(seconds: number): string {
  return `${seconds.toFixed(3)}s`;
}

export function formatStartReactionTick(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function startReactionRating(
  seconds: number,
): Pick<StartReactionModel, "rating" | "label" | "detail"> {
  if (seconds < 0.18) {
    return {
      rating: "exceptional",
      label: "Exceptional",
      detail: "near the edge of believable launch timing",
    };
  }
  if (seconds < 0.23) {
    return {
      rating: "optimal",
      label: "Optimal",
      detail: "right around elite F1 launch territory",
    };
  }
  if (seconds < 0.3) {
    return {
      rating: "good",
      label: "Good",
      detail: "within the normal quick-start window",
    };
  }
  if (seconds <= START_REACTION_RAIL_MAX_SECONDS) {
    return {
      rating: "bad",
      label: "Bad",
      detail: "slower than the usual launch window",
    };
  }
  return {
    rating: "terrible",
    label: "Terrible",
    detail: "over half a second after lights out",
  };
}

export function buildStartReactionModelFromSeconds(
  seconds: unknown,
): StartReactionModel | null {
  // Keep zeros and exporter noise out of the UI. Values over 0.5s are still
  // displayable because they tell a real story, but anything many seconds long
  // is more likely corrupt session metadata than a launch reaction.
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > MAX_VALID_REACTION_SECONDS
  ) {
    return null;
  }

  const railRatio = seconds / START_REACTION_RAIL_MAX_SECONDS;
  const rating = startReactionRating(seconds);

  return {
    seconds,
    formatted: formatStartReactionTime(seconds),
    markerPct: Math.min(railRatio, 1) * 100,
    isDisplayClamped: railRatio > 1,
    ...rating,
  };
}

export function buildStartReactionModel(
  session: TelemetrySession,
  focusedDriver: DriverData | undefined,
): StartReactionModel | null {
  if (!isRaceSession(session) || !focusedDriver?.["is-player"]) return null;

  // PnG's 2026 telemetry format stores a real start reaction here, but older
  // saves and non-start sessions often emit 0. Never estimate from session time:
  // forwarding, platform latency, and integer session-duration packets make it
  // look precise while being materially wrong.
  return buildStartReactionModelFromSeconds(
    session["session-info"]["start-reaction-time"],
  );
}
