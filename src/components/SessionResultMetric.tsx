import type { ReactNode } from "react";
import { ACCENT_TOKENS, type AccentColor } from "../constants/accents";
import type { SessionSummary } from "../types/telemetry";
import { cn } from "../utils/cn";
import { accentCardClass } from "./Card";
import { GridGainGlyph } from "./dashboard/GridGainGlyph";
import {
  gridGainTone,
  podiumIcon,
  positionBadgeClasses,
  positionLabel,
  signedNumber,
} from "./dashboard/helpers";

export type SessionResultKind =
  | "race"
  | "qualifying"
  | "time-trial"
  | "session";

export type SessionLapTone = AccentColor | "muted";

interface SessionResultMetricProps {
  session: SessionSummary;
  kind: SessionResultKind;
  /** Optional richer lap value supplied by track analysis. */
  lapTime?: string;
  lapTimeMs?: number;
  lapTone?: SessionLapTone;
}

function formatPoleGap(playerMs: number, poleMs: number): string {
  const gapMs = playerMs - poleMs;
  if (gapMs <= 0) return "POLE";
  return `+${(gapMs / 1000).toFixed(3)}s`;
}

/** Compact primary stat pill used for lap times and lap-count fallbacks. */
function StatPill({
  value,
  sublabel,
  tone = "purple",
}: {
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: SessionLapTone;
}) {
  const layout = sublabel
    ? "min-w-[5.75rem] flex-col items-end justify-center gap-1 px-2.5 py-1 text-right"
    : "items-center justify-center px-3.5";
  const isMuted = tone === "muted";
  const accent = isMuted ? null : tone;
  const color = accent ? ACCENT_TOKENS[accent].accent : "text-zinc-500";

  return (
    <div
      className={cn(
        "inline-flex h-9 rounded-lg",
        layout,
        accent
          ? accentCardClass(accent)
          : "bg-zinc-900/70 ring-1 ring-inset ring-white/[0.06]",
      )}
    >
      <div
        className={cn(
          "font-mono text-sm font-bold leading-none tabular-nums",
          color,
        )}
      >
        {value}
      </div>
      {sublabel && (
        <div
          className={cn(
            "font-mono text-3xs font-medium uppercase leading-none tracking-wider opacity-60",
            color,
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

function QualifyingPositionChip({ position }: { position: number }) {
  const isPole = position === 1;
  const classes = isPole
    ? cn(accentCardClass("purple"), ACCENT_TOKENS.purple.accent)
    : "bg-zinc-900/70 text-zinc-100 ring-1 ring-inset ring-white/[0.06]";

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

function LapMetric({
  session,
  lapTime,
  tone,
  sublabel,
}: {
  session: SessionSummary;
  lapTime?: string;
  tone?: SessionLapTone;
  sublabel?: string;
}) {
  const value =
    lapTime ??
    session.bestLapTime ??
    session.playerRaceResult?.bestLapTime ??
    `${session.validLapCount} ${session.validLapCount === 1 ? "lap" : "laps"}`;
  return <StatPill value={value} sublabel={sublabel} tone={tone} />;
}

/** Type-aware trailing result shared by Recent Activity and Session History. */
export function SessionResultMetric({
  session,
  kind,
  lapTime,
  lapTimeMs,
  lapTone,
}: SessionResultMetricProps) {
  if (
    kind === "race" &&
    session.playerRaceResult &&
    session.playerRaceResult.position > 0
  ) {
    const result = session.playerRaceResult;
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

  if (kind === "qualifying") {
    const bestLap = lapTime ?? session.bestLapTime;
    const bestLapMs = lapTimeMs ?? session.bestLapTimeMs;
    const position = session.qualifyingPosition;
    if (!bestLap) {
      return (
        <>
          {position != null && position > 0 && (
            <QualifyingPositionChip position={position} />
          )}
          <LapMetric session={session} tone={lapTone} />
        </>
      );
    }

    const sublabel =
      position === 1
        ? "POLE"
        : session.poleLapTimeMs && bestLapMs
          ? formatPoleGap(bestLapMs, session.poleLapTimeMs)
          : "Best lap";

    return (
      <>
        {position != null && position > 0 && (
          <QualifyingPositionChip position={position} />
        )}
        <LapMetric
          session={session}
          lapTime={bestLap}
          tone={lapTone}
          sublabel={sublabel}
        />
      </>
    );
  }

  return <LapMetric session={session} lapTime={lapTime} tone={lapTone} />;
}
