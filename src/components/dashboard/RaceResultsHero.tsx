import { AlertTriangle, ChevronsUp, Flag, Globe, Star, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../Card";
import type { DashboardResultStats } from "../../utils/dashboardStats";
import { GridGainGlyph } from "./GridGainGlyph";
import { RaceResultsProgression } from "./RaceResultsProgression";
import {
  averagePositionLabel,
  dnfRate,
  gridGainTone,
  podiumIcon,
  positionBadgeClasses,
  positionLabel,
  positionTone,
  signedNumber,
} from "./helpers";

function PodiumChip({
  position,
  count,
}: {
  position: 1 | 2 | 3;
  count: number;
}) {
  const Icon = podiumIcon(position)!;
  return (
    <div
      className={`flex flex-1 items-center justify-center gap-3 rounded-xl px-4 py-3 ${positionBadgeClasses(position)}`}
    >
      <Icon className="size-5 shrink-0 opacity-80" />
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          P{position}
        </span>
        <span className="text-2xl font-semibold leading-none tabular-nums">
          {count}
        </span>
      </div>
    </div>
  );
}

function MicroStat({
  label,
  value,
  detail,
  tone = "text-zinc-100",
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
      {detail && <div className="mt-0.5 text-xs text-zinc-500">{detail}</div>}
    </div>
  );
}

export function RaceResultsHero({
  stats,
  bestPosition,
  trackCount,
}: {
  stats: DashboardResultStats;
  bestPosition: number | undefined;
  trackCount: number;
}) {
  const cleanCount = stats.cleanFinishSessions.length;
  const hasAverage = stats.averageFinish != null;
  const headlineValue = hasAverage
    ? averagePositionLabel(stats.averageFinish)
    : positionLabel(bestPosition);
  const headlineCaption = hasAverage
    ? `Average finish · ${cleanCount} clean ${cleanCount === 1 ? "race" : "races"}`
    : "Best finish in scope";
  const gridGain = stats.averageGridGain;
  const podiums = stats.wins + stats.p2 + stats.p3;
  const podiumRate =
    stats.starts > 0 ? Math.round((podiums / stats.starts) * 100) : 0;
  const topFiveRate =
    stats.starts > 0 ? Math.round((stats.topFive / stats.starts) * 100) : 0;
  const frontRowRate =
    stats.gridStarts > 0
      ? Math.round((stats.frontRowStarts / stats.gridStarts) * 100)
      : 0;

  return (
    <Card as="section" className="overflow-hidden">
      {/* Negative margins pull the header strip out of Card's p-5 so the divider
          runs edge-to-edge; the wrapper Card clips them via overflow-hidden. */}
      <header className="-mx-5 -mt-5 mb-6 flex items-center justify-between border-b border-white/[0.05] px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-zinc-400">
          {(stats.mode === "representative-online" || stats.mode === "online") && (
            <Globe className="size-3 text-zinc-500" />
          )}
          {stats.modeLabel}
        </span>
        <span className="text-zinc-500">
          {stats.starts} {stats.starts === 1 ? "start" : "starts"}
          {trackCount > 0 &&
            ` · ${trackCount} ${trackCount === 1 ? "track" : "tracks"}`}
        </span>
      </header>

      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="text-6xl font-semibold leading-none tracking-tight tabular-nums text-zinc-100">
            {headlineValue}
          </div>
          <div className="mt-2 text-sm text-zinc-400">{headlineCaption}</div>
          {gridGain != null && (
            <div
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-mono ${gridGainTone(gridGain)}`}
            >
              <GridGainGlyph value={gridGain} />
              <span>{signedNumber(gridGain)} avg grid Δ</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2 md:min-w-[20rem]">
          <div className="flex gap-2 sm:gap-3">
            <PodiumChip position={1} count={stats.wins} />
            <PodiumChip position={2} count={stats.p2} />
            <PodiumChip position={3} count={stats.p3} />
          </div>
          {podiums > 0 && (
            <p className="text-right text-[11px] uppercase tracking-wider text-zinc-500">
              {podiums} {podiums === 1 ? "podium" : "podiums"} · {podiumRate}%
              rate
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/[0.05] pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <MicroStat
          label="Front row"
          value={stats.gridStarts > 0 ? `${frontRowRate}%` : "—"}
          detail={
            stats.gridStarts > 0
              ? `${stats.frontRowStarts} of ${stats.gridStarts} · ${stats.polePositions} from P1`
              : undefined
          }
          tone={stats.frontRowStarts > 0 ? "text-ahead" : "text-zinc-300"}
          icon={Flag}
        />
        <MicroStat
          label="Top 5"
          value={stats.topFive}
          detail={
            stats.starts > 0 ? `${topFiveRate}% of ${stats.starts}` : undefined
          }
          icon={ChevronsUp}
        />
        <MicroStat
          label="Best"
          value={positionLabel(bestPosition)}
          detail="single race"
          icon={Star}
          tone={positionTone(bestPosition)}
        />
        <MicroStat
          label="DNF rate"
          value={dnfRate(stats.dnfCount, stats.starts)}
          detail={
            stats.dnfCount > 0 ? `${stats.dnfCount} retired` : "clean run"
          }
          tone={stats.dnfCount > 0 ? "text-behind" : "text-zinc-300"}
          icon={AlertTriangle}
        />
      </div>

      {stats.resultSessions.length >= 2 && (
        <RaceResultsProgression sessions={stats.resultSessions} />
      )}

      {stats.modeDetail && (
        <p className="mt-5 text-xs text-zinc-500">{stats.modeDetail}</p>
      )}
    </Card>
  );
}
