import type { DashboardActivityGroup } from "../../analysis/dashboardActivity";
import { formatTime } from "../../utils/format";
import { sessionSummaryPath } from "../../utils/routes";
import { getTrackDisplayName } from "../../utils/tracks";
import { SessionResultMetric } from "../SessionResultMetric";
import { SessionResultStatusBadge } from "../SessionResultStatusBadge";
import { SessionTypeBadge } from "../SessionTypeBadge";
import { TrackFlag } from "../TrackFlag";
import { SessionRow } from "../SessionRow";
import { resolveSessionMode } from "../sessionModeMeta";
import { Badge } from "../ui/Badge";

function modeLabel(session: DashboardActivityGroup["representative"]): string {
  if (session.isSpectator) return "Spectator";
  return (
    resolveSessionMode(session.isOnline, session.aiDifficulty, true)?.label ??
    "Offline"
  );
}

function attemptLabel(activity: DashboardActivityGroup): string | null {
  const count = activity.sessions.length;
  if (count <= 1) return null;
  if (activity.kind === "race") return `${count} attempts`;
  return `best of ${count}`;
}

export function ActivityRow({
  activity,
}: {
  activity: DashboardActivityGroup;
}) {
  const session = activity.representative;
  const result = session.playerRaceResult;
  const attempt = attemptLabel(activity);
  const isTimeTrial = activity.kind === "time-trial";
  const trackName = getTrackDisplayName(session.track);

  // Time Trial is solo by definition — "Online · 1 drivers" is meaningless
  // noise. For race/quali, keep the field size when we actually have an
  // online lobby or a classified grid bigger than the player.
  const showMode = !isTimeTrial;
  const fieldSize = isTimeTrial
    ? 0
    : session.onlineDriverCount ||
      session.qualifyingFieldSize ||
      session.classifiedDriverCount ||
      result?.fieldSize ||
      0;
  const showFieldSize = fieldSize > 1;

  return (
    <SessionRow
      to={session.isSynthetic ? null : sessionSummaryPath(session)}
      leading={
        <>
          <TrackFlag track={session.track} />
          <span className="truncate text-sm font-medium text-zinc-100">
            {trackName}
          </span>
          <SessionTypeBadge
            sessionType={session.sessionType}
            formula={session.formula}
          />
          <SessionResultStatusBadge status={result?.status} />
          {attempt && (
            <Badge tone="zinc" className="max-sm:hidden">
              {attempt}
            </Badge>
          )}
        </>
      }
      meta={
        <>
          {formatTime(session.date)}
          {showMode && ` · ${modeLabel(session)}`}
          {showFieldSize && ` · ${fieldSize} drivers`}
          {result?.totalLaps
            ? ` · ${result.playerLaps}/${result.totalLaps} laps`
            : ""}
        </>
      }
      trailing={<SessionResultMetric session={session} kind={activity.kind} />}
    />
  );
}
