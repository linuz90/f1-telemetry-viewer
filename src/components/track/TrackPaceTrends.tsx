import { Timer } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type DotItemDotProps,
} from "recharts";
import type {
  LapTimesBySession,
  SectorCardModel,
  TrackPaceAnalysis,
} from "../../analysis/trackAnalysis";
import {
  CHART_THEME,
  SECTOR_COLORS,
  TOOLTIP_STYLE,
} from "../../constants/colors";
import {
  joinMetaParts,
  msToLapTime,
  msToSectorTime,
  pluralize,
} from "../../utils/format";
import { cardClass } from "../Card";
import { InsightDetail, InsightValue } from "../ui/InsightText";
import { InsightTile } from "../ui/InsightTile";
import { SectionHeader } from "../ui/SectionHeader";

/**
 * Qualifying and Time Trial progress at one track: every lap by session with
 * the best-lap line and theoretical best, then each sector's all-time best
 * with its per-session trend.
 */
export function TrackPaceTrends({
  pace,
  sectorTitle,
}: {
  pace: TrackPaceAnalysis;
  /** Sector tile eyebrow after "S1 — ", e.g. "All-Time Best". */
  sectorTitle: string;
}) {
  const { lapTimes, sectorCards, theoreticalBestMs, latest, theoreticalS1 } =
    pace;
  const lapCount = lapTimes.validLaps.length + lapTimes.invalidLaps.length;

  return (
    <>
      {lapCount >= 2 && (
        <LapTimesChart
          lapTimes={lapTimes}
          theoreticalBestMs={theoreticalBestMs}
        />
      )}
      {latest && theoreticalS1 > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {sectorCards.map((card) => (
            <SectorBestTile
              key={card.label}
              title={`${card.label} — ${sectorTitle}`}
              card={card}
            />
          ))}
        </div>
      )}
    </>
  );
}

function LapTimesChart({
  lapTimes,
  theoreticalBestMs,
}: {
  lapTimes: LapTimesBySession;
  theoreticalBestMs: number;
}) {
  const { sessions, validLaps, invalidLaps } = lapTimes;
  const byIdx = new Map(sessions.map((session) => [session.idx, session]));

  return (
    <section className={cardClass}>
      <SectionHeader
        title="Lap Times by Session"
        hint={`every timed lap · best per session joined · ${pluralize(sessions.length, "session")}`}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={sessions}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="idx"
            type="number"
            domain={[0.5, sessions.length + 0.5]}
            ticks={sessions.map((session) => session.idx)}
            tickFormatter={(idx: number) => byIdx.get(idx)?.tick ?? ""}
            interval="preserveStartEnd"
            minTickGap={12}
            stroke={CHART_THEME.axis}
            fontSize={11}
          />
          <YAxis
            type="number"
            domain={["auto", "auto"]}
            tickFormatter={(value: number) => msToLapTime(value * 1000)}
            stroke={CHART_THEME.axis}
            fontSize={11}
            width={64}
          />
          <ZAxis range={[48, 48]} />
          <Tooltip
            cursor={{ stroke: CHART_THEME.muted, strokeDasharray: "3 3" }}
            content={({ active, label }) => {
              const session =
                active && typeof label === "number"
                  ? byIdx.get(label)
                  : undefined;
              if (!session) return null;
              return (
                <div
                  style={{
                    ...TOOLTIP_STYLE.contentStyle,
                    padding: "8px 12px",
                  }}
                  className="space-y-0.5 text-zinc-300"
                >
                  <div className="mb-1 text-2xs text-zinc-400">
                    {session.label}
                  </div>
                  <div className="font-mono text-best">
                    {session.bestLapSec != null
                      ? `Best ${msToLapTime(session.bestLapSec * 1000)}`
                      : "No complete valid lap"}
                  </div>
                  <div>
                    {joinMetaParts([
                      pluralize(session.validLapCount, "valid lap"),
                      session.invalidLapCount > 0
                        ? `${session.invalidLapCount} invalid`
                        : null,
                    ])}
                  </div>
                  {session.stdDevSec != null && (
                    <div className="font-mono text-zinc-400">
                      Spread ±{session.stdDevSec.toFixed(3)} s
                    </div>
                  )}
                </div>
              );
            }}
          />
          {theoreticalBestMs > 0 && (
            <ReferenceLine
              y={theoreticalBestMs / 1000}
              stroke={CHART_THEME.ahead}
              strokeDasharray="6 4"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
            />
          )}
          <Scatter
            data={invalidLaps}
            dataKey="timeSec"
            fill={CHART_THEME.behind}
            fillOpacity={0.4}
          />
          <Scatter
            data={validLaps}
            dataKey="timeSec"
            fill={CHART_THEME.player}
            fillOpacity={0.6}
          />
          <Line
            type="linear"
            dataKey="bestLapSec"
            connectNulls
            stroke={CHART_THEME.best}
            strokeWidth={2}
            dot={{ fill: CHART_THEME.best, r: 4, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <LegendDot className="bg-cyan-400">Valid lap</LegendDot>
        <LegendDot className="bg-red-500/50">Invalid lap</LegendDot>
        <LegendDot className="bg-purple-400">Best per session</LegendDot>
        {theoreticalBestMs > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 border-t-2 border-dashed border-ahead" />
            Theoretical best{" "}
            <span className="font-mono text-zinc-400">
              {msToLapTime(theoreticalBestMs)}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}

function LegendDot({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-full ${className}`} />
      {children}
    </span>
  );
}

/**
 * All-time best sector tile in the shared `InsightTile` family. Only the
 * number is tinted; the sparkline under it shows each session's best in that
 * sector on its own scale, which a chart shared by 17 s and 39 s sectors
 * flattens out.
 */
function SectorBestTile({
  title,
  card,
}: {
  title: string;
  card: SectorCardModel;
}) {
  const { bestMs, latestMs, trendMs } = card;
  const deltaMs = latestMs > 0 && bestMs > 0 ? latestMs - bestMs : 0;
  const color = SECTOR_COLORS[card.label as keyof typeof SECTOR_COLORS];

  return (
    <InsightTile title={title} icon={Timer} accent="purple">
      <InsightValue size="md" tone="text-best">
        {bestMs > 0 ? msToSectorTime(bestMs) : "–"}
      </InsightValue>
      {latestMs > 0 && (
        <InsightDetail size="sm" tone="text-zinc-500" className="mt-1">
          <span className="text-zinc-500">Latest: </span>
          <span className="font-mono text-zinc-300">
            {msToSectorTime(latestMs)}
          </span>
          {deltaMs > 0 && (
            <span className="ml-1 whitespace-nowrap font-mono text-warning">
              +{(deltaMs / 1000).toFixed(3)}
            </span>
          )}
          {deltaMs === 0 && bestMs > 0 && (
            <span className="ml-1 font-mono text-ahead">PB</span>
          )}
        </InsightDetail>
      )}
      {trendMs.length > 1 && (
        <SectorSparkline
          label={`${card.label} best per session, oldest to newest`}
          values={trendMs}
          color={color ?? CHART_THEME.axis}
        />
      )}
    </InsightTile>
  );
}

/** Lower is faster, as on the lap-times chart; the purple dot is the PB. */
function SectorSparkline({
  label,
  values,
  color,
}: {
  label: string;
  values: readonly number[];
  color: string;
}) {
  const data = values.map((ms, index) => ({ index, sec: ms / 1000 }));
  const bestIndex = values.indexOf(Math.min(...values));
  const lastIndex = values.length - 1;

  const renderDot = ({ index, cx, cy }: DotItemDotProps) => {
    if (index !== bestIndex && index !== lastIndex) {
      return <g key={index} />;
    }
    return (
      <circle
        key={index}
        cx={cx}
        cy={cy}
        r={2.5}
        fill={index === bestIndex ? CHART_THEME.best : color}
      />
    );
  };

  return (
    <div role="img" aria-label={label} className="mt-2.5">
      <ResponsiveContainer width="100%" height={28}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
        >
          <XAxis dataKey="index" hide />
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Line
            type="linear"
            dataKey="sec"
            stroke={color}
            strokeWidth={1.5}
            dot={renderDot}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
