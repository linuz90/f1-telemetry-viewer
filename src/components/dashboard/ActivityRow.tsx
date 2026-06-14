import { ACCENT_TOKENS, accentCardClass } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { Badge, type BadgeTone } from "../ui/Badge";
import { SessionRow } from "../SessionRow";
import type { DashboardActivityGroup } from "../../utils/dashboardActivity";
import {
  formatDate,
  formatShortDate,
  formatSessionType,
  formatTime,
} from "../../utils/format";
import { sessionSummaryPath } from "../../utils/routes";
import { GridGainGlyph } from "./GridGainGlyph";
import {
  gridGainTone,
  isProblemStatus,
  podiumIcon,
  positionBadgeClasses,
  positionLabel,
  resultStatusLabel,
  signedNumber,
} from "./helpers";

function modeLabel(session: DashboardActivityGroup["representative"]): string {
  if (session.isSpectator) return "Spectator";
  if (session.aiDifficulty != null && session.aiDifficulty > 0) {
    return `AI ${session.aiDifficulty}`;
  }
  return "Online";
}

function kindTone(activity: DashboardActivityGroup): BadgeTone {
  if (activity.kind === "race") return "red";
  if (activity.kind === "qualifying") return "amber";
  if (activity.kind === "time-trial") return "sky";
  return "zinc";
}

function attemptLabel(activity: DashboardActivityGroup): string | null {
  const count = activity.sessions.length;
  if (count <= 1) return null;
  if (activity.kind === "race") return `${count} attempts`;
  return `best of ${count}`;
}

function LapMetric({
  session,
  label,
}: {
  session: DashboardActivityGroup["representative"];
  label?: string;
}) {
  const hasBestLap = Boolean(session.bestLapTime);
  const value = session.bestLapTime ?? String(session.validLapCount);
  const metricLabel =
    label ??
    (hasBestLap
      ? null
      : `${session.validLapCount === 1 ? "valid lap" : "valid laps"}`);

  const chipLayout = metricLabel
    ? "min-w-[5.75rem] flex-col items-end px-2.5 text-right"
    : "items-center justify-center px-3.5";

  return (
    <div
      className={`inline-flex h-9 rounded-lg ${chipLayout} ${accentCardClass("purple")}`}
    >
      <div
        className={`font-mono text-sm font-bold leading-none tabular-nums ${ACCENT_TOKENS.purple.accent}`}
      >
        {value}
      </div>
      {metricLabel && (
        <div className="mt-0.5 text-[9px] font-medium uppercase leading-none tracking-wider text-purple-200/60">
          {metricLabel}
        </div>
      )}
    </div>
  );
}

function RaceMetric({
  session,
}: {
  session: DashboardActivityGroup["representative"];
}) {
  const result = session.playerRaceResult;
  if (!result) {
    return (
      <LapMetric
        session={session}
        label={`${session.validLapCount} ${session.validLapCount === 1 ? "lap" : "laps"}`}
      />
    );
  }

  const gridGain = result.gridPosition
    ? result.gridPosition - result.position
    : undefined;
  const Icon = podiumIcon(result.position);

  return (
    <>
      <div
        className={`inline-flex items-center gap-1.5 font-mono text-sm ${gridGainTone(gridGain)}`}
      >
        <GridGainGlyph value={gridGain} />
        <span className="tabular-nums">{signedNumber(gridGain)}</span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          grid
        </span>
      </div>

      <div
        className={`inline-flex h-9 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-bold tabular-nums ${positionBadgeClasses(result.position)}`}
      >
        {Icon ? <Icon className="size-3.5" /> : null}
        <span>{positionLabel(result.position)}</span>
      </div>
    </>
  );
}

export function ActivityRow({
  activity,
}: {
  activity: DashboardActivityGroup;
}) {
  const session = activity.representative;
  const result = session.playerRaceResult;
  const problem = isProblemStatus(result?.status);
  const attempt = attemptLabel(activity);
  const typeLabel = formatSessionType(session.sessionType, session.formula);
  const fieldSize =
    session.onlineDriverCount ||
    session.classifiedDriverCount ||
    result?.fieldSize ||
    0;

  return (
    <SessionRow
      to={session.isSynthetic ? null : sessionSummaryPath(session)}
      leading={
        <>
          <TrackFlag track={session.track} />
          <span className="truncate text-sm font-medium text-zinc-100">
            {session.track}
          </span>
          <Badge tone={kindTone(activity)} className="max-sm:!hidden">
            {typeLabel}
          </Badge>
          <Badge tone="zinc" className="sm:hidden">
            {formatShortDate(session.date)}
          </Badge>
          {problem && <Badge tone="red">{resultStatusLabel(result?.status)}</Badge>}
          {attempt && (
            <Badge tone="zinc" className="max-sm:hidden">
              {attempt}
            </Badge>
          )}
        </>
      }
      meta={
        <>
          {formatDate(session.date)} · {formatTime(session.date)} ·{" "}
          {modeLabel(session)}
          {fieldSize > 0 && ` · ${fieldSize} drivers`}
          {result?.totalLaps
            ? ` · ${result.playerLaps}/${result.totalLaps} laps`
            : ""}
        </>
      }
      trailing={
        activity.kind === "race" ? (
          <RaceMetric session={session} />
        ) : (
          <LapMetric session={session} />
        )
      }
    />
  );
}
