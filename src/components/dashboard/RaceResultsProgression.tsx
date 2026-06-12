import { Link } from "react-router-dom";
import { TrackFlag } from "../TrackFlag";
import type { SessionSummary } from "../../types/telemetry";
import { formatShortDate } from "../../utils/format";
import { sessionFormulaPath } from "../../utils/routes";
import { getFormulaComparisonKey } from "../../utils/sessionTypes";
import { isProblemStatus } from "./helpers";

// Race-by-race progression: two bars per online race (grid → finish).
// Bar height is field-size-relative so P1 is full and last place shrinks toward
// the baseline. Bar color encodes the race outcome (gold/silver/bronze/points/
// dim/DNF); the quali bar mirrors the finish hue at lower opacity so the eye
// reads outcome first. Pole sittings get an amber outline on the quali bar.
function raceResultTier(
  position: number | undefined,
  isDnf: boolean,
): "dnf" | "p1" | "p2" | "p3" | "points" | "out" {
  if (isDnf) return "dnf";
  if (position === 1) return "p1";
  if (position === 2) return "p2";
  if (position === 3) return "p3";
  if (position != null && position <= 10) return "points";
  return "out";
}

const RACE_TIER_CLASS: Record<
  ReturnType<typeof raceResultTier>,
  { race: string }
> = {
  p1: { race: "bg-amber-400" },
  p2: { race: "bg-zinc-300" },
  p3: { race: "bg-orange-500" },
  points: { race: "bg-emerald-500/70" },
  out: { race: "bg-zinc-600" },
  dnf: { race: "bg-red-500/70" },
};

function ProgressionLegendSwatch({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block size-2 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

const PROGRESSION_BAR_AREA_PX = 96;

export function RaceResultsProgression({
  sessions,
}: {
  sessions: SessionSummary[];
}) {
  const ordered = [...sessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const firstDate = formatShortDate(ordered[0]!.date);
  const lastDate = formatShortDate(ordered.at(-1)!.date);

  return (
    <div className="mt-6 border-t border-zinc-800/60 pt-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Race-by-race
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            Grid (left) vs finish (right). Taller = higher up the order.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
          <ProgressionLegendSwatch className="bg-purple-500/80" label="Pole" />
          <ProgressionLegendSwatch
            className={RACE_TIER_CLASS.p1.race}
            label="Win"
          />
          <ProgressionLegendSwatch
            className={RACE_TIER_CLASS.p2.race}
            label="P2"
          />
          <ProgressionLegendSwatch
            className={RACE_TIER_CLASS.p3.race}
            label="P3"
          />
          <ProgressionLegendSwatch
            className={RACE_TIER_CLASS.points.race}
            label="Points"
          />
          <ProgressionLegendSwatch
            className={RACE_TIER_CLASS.out.race}
            label="P11+"
          />
          <span className="inline-flex items-center gap-1 text-behind">
            <span className="text-[10px] leading-none">💥</span>DNF
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-1 sm:gap-1.5">
        {ordered.map((session) => (
          <ProgressionColumn key={session.relativePath} session={session} />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-600">
        <span>{firstDate}</span>
        <span className="text-zinc-700">first → latest</span>
        <span>{lastDate}</span>
      </div>
    </div>
  );
}

function ProgressionBar({
  position,
  fieldSize,
  colorClass,
  label,
  labelClass,
}: {
  position: number;
  fieldSize: number;
  colorClass: string;
  label: string;
  labelClass: string;
}) {
  const heightPx = Math.max(
    6,
    ((fieldSize - position + 1) / fieldSize) * PROGRESSION_BAR_AREA_PX,
  );
  return (
    <div className="flex h-full flex-col items-center justify-end gap-0.5">
      <span
        className={`font-mono text-[9px] leading-none tabular-nums ${labelClass}`}
      >
        {label}
      </span>
      <div
        className={`w-2 rounded-t-sm transition-all group-hover:brightness-125 ${colorClass}`}
        style={{ height: `${heightPx}px` }}
      />
    </div>
  );
}

function ProgressionColumn({ session }: { session: SessionSummary }) {
  const result = session.playerRaceResult;
  if (!result) return <div className="min-w-0 flex-1" />;

  const fieldSize =
    session.onlineDriverCount ||
    session.classifiedDriverCount ||
    result.fieldSize ||
    20;
  const isDnf = isProblemStatus(result.status);
  const tier = raceResultTier(result.position, isDnf);
  const classes = RACE_TIER_CLASS[tier];
  const grid = result.gridPosition;
  const isPole = grid === 1;

  // Quali bars stay neutral so the race outcome reads first; pole sittings get
  // the PB-purple used elsewhere (qualifying-pace charts, best-lap chips) to
  // visually mark "fastest in qualifying".
  const qualiColor = isPole ? "bg-purple-500/80" : "bg-zinc-600";
  const qualiLabelClass = isPole ? "text-best" : "text-zinc-500";

  const finishLabel = isDnf ? "💥" : `P${result.position}`;
  const finishLabelClass = isDnf ? "text-behind" : "text-zinc-200";
  const gridLabel = grid ? `P${grid}` : "—";
  const title = `${session.track} · ${formatShortDate(session.date)}\nGrid ${gridLabel} → Finish ${isDnf ? "DNF" : `P${result.position}`}`;
  const to = sessionFormulaPath(
    session.slug,
    getFormulaComparisonKey(session.formula, session.gameYear),
  );

  return (
    <Link
      to={to}
      title={title}
      className="group flex min-w-0 flex-col items-center gap-2.5"
    >
      <div
        className="flex items-end gap-[4px]"
        style={{ height: `${PROGRESSION_BAR_AREA_PX + 12}px` }}
      >
        {grid != null ? (
          <ProgressionBar
            position={grid}
            fieldSize={fieldSize}
            colorClass={qualiColor}
            label={gridLabel}
            labelClass={qualiLabelClass}
          />
        ) : (
          <div className="w-2" />
        )}
        <ProgressionBar
          position={result.position}
          fieldSize={fieldSize}
          colorClass={classes.race}
          label={finishLabel}
          labelClass={finishLabelClass}
        />
      </div>
      <TrackFlag
        track={session.track}
        className="w-4.5! h-3! opacity-70 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}
