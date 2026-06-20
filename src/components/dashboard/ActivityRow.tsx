import { cn } from "../../utils/cn";
import { ACCENT_TOKENS, type AccentColor } from "../../constants/accents";
import { accentCardClass } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { Badge } from "../ui/Badge";
import { SessionRow } from "../SessionRow";
import { getSessionTypeMeta } from "../sessionTypeMeta";
import type { DashboardActivityGroup } from "../../analysis/dashboardActivity";
import type { SessionSummary } from "../../types/telemetry";
import { formatSessionType, formatTime } from "../../utils/format";
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

function attemptLabel(activity: DashboardActivityGroup): string | null {
  const count = activity.sessions.length;
  if (count <= 1) return null;
  if (activity.kind === "race") return `${count} attempts`;
  return `best of ${count}`;
}

function formatPoleGap(playerMs: number, poleMs: number): string {
  const gapMs = playerMs - poleMs;
  if (gapMs <= 0) return "POLE";
  return `+${(gapMs / 1000).toFixed(3)}s`;
}

/**
 * Compact accent pill used as a row's primary stat (best lap, lap count, etc.).
 * The optional sub-label sits underneath the value, both centered vertically
 * inside the pill.
 */
function StatPill({
  value,
  sublabel,
  accent = "purple",
}: {
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  accent?: AccentColor;
}) {
  const layout = sublabel
    ? "min-w-[5.75rem] flex-col items-end justify-center gap-1 px-2.5 py-1 text-right"
    : "items-center justify-center px-3.5";

  return (
    <div
      className={cn(
        "inline-flex h-9 rounded-lg",
        layout,
        accentCardClass(accent),
      )}
    >
      <div
        className={cn(
          "font-mono text-sm font-bold leading-none tabular-nums",
          ACCENT_TOKENS[accent].accent,
        )}
      >
        {value}
      </div>
      {sublabel && (
        <div
          className={cn(
            "font-mono text-3xs font-medium uppercase leading-none tracking-wider opacity-60",
            ACCENT_TOKENS[accent].accent,
          )}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

function PositionChip({ position }: { position: number }) {
  const Icon = podiumIcon(position);
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-bold tabular-nums",
        positionBadgeClasses(position),
      )}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      <span>{positionLabel(position)}</span>
    </div>
  );
}

/**
 * Qualifying-specific chip — `Q P3` rather than the race podium badge.
 * Pole gets the purple "fastest" accent (broadcast convention); every other
 * position is neutral, because finishing P2 in quali isn't a "podium" the way
 * P2 in a race is.
 */
function QualiPositionChip({ position }: { position: number }) {
  const isPole = position === 1;
  const classes = isPole
    ? cn(accentCardClass("purple"), ACCENT_TOKENS.purple.accent)
    : "ring-1 ring-inset ring-white/[0.06] bg-zinc-900/70 text-zinc-100";
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg px-2.5 text-sm font-bold tabular-nums",
        classes,
      )}
    >
      Q P{position}
    </div>
  );
}

function RaceMetric({ session }: { session: SessionSummary }) {
  const result = session.playerRaceResult;
  if (!result) {
    return <LapFallbackMetric session={session} />;
  }

  const gridGain = result.gridPosition
    ? result.gridPosition - result.position
    : undefined;

  return (
    <>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 font-mono text-sm max-sm:hidden",
          gridGainTone(gridGain),
        )}
      >
        <GridGainGlyph value={gridGain} />
        <span className="tabular-nums">{signedNumber(gridGain)}</span>
        <span className="font-mono text-2xs uppercase tracking-wider text-zinc-500">
          grid
        </span>
      </div>

      <PositionChip position={result.position} />
    </>
  );
}

function QualifyingMetric({ session }: { session: SessionSummary }) {
  const position = session.qualifyingPosition;
  const bestLap = session.bestLapTime;
  const bestLapMs = session.bestLapTimeMs;
  const poleMs = session.poleLapTimeMs;

  if (!bestLap) {
    return <LapFallbackMetric session={session} />;
  }

  const isPole = position === 1;
  const sublabel = isPole
    ? "POLE"
    : poleMs && bestLapMs
      ? formatPoleGap(bestLapMs, poleMs)
      : "Best lap";

  return (
    <>
      {position != null && <QualiPositionChip position={position} />}
      <StatPill value={bestLap} sublabel={sublabel} />
    </>
  );
}

function LapFallbackMetric({ session }: { session: SessionSummary }) {
  const value =
    session.bestLapTime ??
    `${session.validLapCount} ${session.validLapCount === 1 ? "lap" : "laps"}`;
  return <StatPill value={value} />;
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
  const typeMeta = getSessionTypeMeta(typeLabel);
  const TypeIcon = typeMeta.icon;
  const isTimeTrial = activity.kind === "time-trial";

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
            {session.track}
          </span>
          <Badge tone={typeMeta.badgeTone} className="gap-1">
            <TypeIcon className="size-3" />
            {typeLabel}
          </Badge>
          {problem && (
            <Badge tone="red">{resultStatusLabel(result?.status)}</Badge>
          )}
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
      trailing={
        activity.kind === "race" ? (
          <RaceMetric session={session} />
        ) : activity.kind === "qualifying" ? (
          <QualifyingMetric session={session} />
        ) : (
          <LapFallbackMetric session={session} />
        )
      }
    />
  );
}
