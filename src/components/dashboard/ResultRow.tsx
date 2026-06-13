import { SessionRow } from "../SessionRow";
import { TrackFlag } from "../TrackFlag";
import { Badge } from "../ui/Badge";
import type { SessionSummary } from "../../types/telemetry";
import {
  formatDate,
  formatSessionType,
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

export function ResultRow({ session }: { session: SessionSummary }) {
  const result = session.playerRaceResult;
  const gridGain = result?.gridPosition
    ? result.gridPosition - result.position
    : undefined;
  const fieldSize =
    session.onlineDriverCount ||
    session.classifiedDriverCount ||
    result?.fieldSize ||
    0;
  const status = result?.status;
  const problem = isProblemStatus(status);
  const Icon = podiumIcon(result?.position);
  const to = sessionSummaryPath(session);

  return (
    <SessionRow
      to={session.isSynthetic ? null : to}
      leading={
        <>
          <TrackFlag track={session.track} />
          <span className="truncate text-sm font-medium text-zinc-100">
            {session.track}
          </span>
          {problem && <Badge tone="red">{resultStatusLabel(status)}</Badge>}
        </>
      }
      meta={
        <>
          {formatSessionType(session.sessionType, session.formula)} ·{" "}
          {formatDate(session.date)}
          {fieldSize > 0 && ` · ${fieldSize} drivers`}
          {result?.totalLaps
            ? ` · ${result.playerLaps}/${result.totalLaps} laps`
            : ""}
        </>
      }
      trailing={
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
            className={`inline-flex h-9 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-bold tabular-nums ${positionBadgeClasses(result?.position)}`}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            <span>{positionLabel(result?.position)}</span>
          </div>
        </>
      }
    />
  );
}
