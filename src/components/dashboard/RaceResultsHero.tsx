import {
  AlertTriangle,
  ChevronsUp,
  Flag,
  Globe,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";
import type { DashboardResultStats } from "../../analysis/dashboardResultStats";
import { Card } from "../Card";
import { Eyebrow } from "../ui/Eyebrow";
import { InsightDetail, InsightValue } from "../ui/InsightText";
import { HStack, VStack } from "../ui/Stack";
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
    <HStack
      justify="center"
      className={cn(
        "flex-1 gap-3 rounded-xl px-4 py-3",
        positionBadgeClasses(position),
      )}
    >
      <Icon className="size-5 shrink-0 opacity-80" />
      <VStack align="start" className="gap-0.5">
        <span className="font-mono text-2xs font-bold uppercase tracking-wider opacity-80">
          P{position}
        </span>
        <span className="text-2xl font-semibold leading-none tabular-nums">
          {count}
        </span>
      </VStack>
    </HStack>
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
      <HStack className="gap-1.5">
        {Icon && <Icon className="size-3" />}
        <Eyebrow>{label}</Eyebrow>
      </HStack>
      <InsightValue size="lg" tone={tone} className="mt-1">
        {value}
      </InsightValue>
      {detail && (
        <InsightDetail size="sm" tone="text-zinc-500" className="mt-0.5">
          {detail}
        </InsightDetail>
      )}
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
      <HStack
        as="header"
        justify="between"
        className="-mx-5 -mt-5 mb-6 border-b border-white/[0.05] px-5 py-3 text-xs"
      >
        <span className="inline-flex items-center gap-1.5 font-mono font-semibold uppercase tracking-wider text-zinc-400">
          {(stats.mode === "representative-online" ||
            stats.mode === "online") && (
            <Globe className="size-3 text-zinc-500" />
          )}
          {stats.modeLabel}
        </span>
        <span className="text-zinc-500 font-mono">
          {stats.starts} {stats.starts === 1 ? "start" : "starts"}
          {trackCount > 0 &&
            ` · ${trackCount} ${trackCount === 1 ? "track" : "tracks"}`}
        </span>
      </HStack>

      <VStack className="gap-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-6xl font-semibold leading-[0.8] tracking-tight tabular-nums text-zinc-100 mb-3.5">
            {headlineValue}
          </div>
          <div className="mt-2 font-mono text-sm tabular-nums text-zinc-400">
            {headlineCaption}
          </div>
          {gridGain != null && (
            <div
              className={cn(
                "mt-3 inline-flex items-center gap-1.5 text-xs font-mono",
                gridGainTone(gridGain),
              )}
            >
              <GridGainGlyph value={gridGain} />
              <span>{signedNumber(gridGain)} avg grid Δ</span>
            </div>
          )}
        </div>

        <VStack className="gap-2 md:min-w-[20rem]">
          <HStack className="gap-2 sm:gap-3">
            <PodiumChip position={1} count={stats.wins} />
            <PodiumChip position={2} count={stats.p2} />
            <PodiumChip position={3} count={stats.p3} />
          </HStack>
          {podiums > 0 && (
            <p className="text-right font-mono text-xs uppercase tracking-wider text-zinc-500">
              {podiums} {podiums === 1 ? "podium" : "podiums"} · {podiumRate}%
              rate
            </p>
          )}
        </VStack>
      </VStack>

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
        <p className="mt-5 font-mono text-xs tabular-nums text-zinc-500">
          {stats.modeDetail}
        </p>
      )}
    </Card>
  );
}
