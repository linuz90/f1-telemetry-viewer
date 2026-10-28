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
import { CHART_THEME, TOOLTIP_STYLE } from "../../constants/colors";
import {
  joinMetaParts,
  msToLapTime,
  msToSectorTime,
  pluralize,
} from "../../utils/format";
import { cardClass } from "../Card";
import { formatLapTick, lapTimeAxis } from "../charts/lapTimeAxis";
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
  /** Sector tile label after "Sector 1 ", e.g. "best". */
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {sectorCards.map((card) => (
            <SectorBestTile
              key={card.label}
              title={`${card.label.replace(/^S/, "Sector ")} ${sectorTitle}`}
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
  // The scale fits valid laps and the theoretical best; a wild invalid lap
  // clips at the top instead of flattening the rest.
  const fitted = [
    ...validLaps.map((lap) => lap.timeSec * 1000),
    ...(theoreticalBestMs > 0 ? [theoreticalBestMs] : []),
  ];
  const axis = lapTimeAxis(
    Math.min(...(fitted.length ? fitted : [0])),
    Math.max(...(fitted.length ? fitted : [1])),
  );

  return (
    <section className={cardClass}>
      <SectionHeader
        title="Lap times by session"
        hint={`Every timed lap, each session's best joined · ${pluralize(sessions.length, "session")}`}
      />
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={sessions}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke={CHART_THEME.grid} />
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
            domain={[axis.domain[0] / 1000, axis.domain[1] / 1000]}
            ticks={axis.ticks.map((t) => t / 1000)}
            allowDataOverflow
            tickFormatter={(value: number) =>
              formatLapTick(value * 1000, axis.stepMs)
            }
            stroke={CHART_THEME.axis}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={52}
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
                  className="space-y-0.5 text-tone-300"
                >
                  <div className="mb-1 text-2xs text-tone-400">
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
                    <div className="font-mono text-tone-400">
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
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-tone-500">
        <LegendDot className="bg-chart-you/70">Valid lap</LegendDot>
        <LegendDot className="bg-behind/50">Invalid lap</LegendDot>
        <LegendDot className="bg-best">Best per session</LegendDot>
        {theoreticalBestMs > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3.5 border-t-2 border-dashed border-ahead" />
            Theoretical best{" "}
            <span className="font-mono text-tone-400">
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
 * Best sector card, in the stat style the session pages use. Only the number
 * is tinted; the sparkline under it shows each session's best in that sector
 * on its own scale, which a chart shared by 17 s and 39 s sectors flattens
 * out.
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

  return (
    <div className="rounded-2xl bg-tone-900 p-4 ring-1 ring-tone-800">
      <div className="text-xs text-tone-500">{title}</div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight text-best">
        {bestMs > 0 ? msToSectorTime(bestMs) : "–"}
      </div>
      {latestMs > 0 && (
        <div className="mt-0.5 text-xs text-tone-500">
          Latest{" "}
          <span className="font-mono text-tone-300">
            {msToSectorTime(latestMs)}
          </span>
          {deltaMs > 0 && (
            <span className="ml-1 whitespace-nowrap font-mono text-warning">
              +{(deltaMs / 1000).toFixed(3)}
            </span>
          )}
          {deltaMs === 0 && bestMs > 0 && (
            <span className="ml-1 font-mono text-best">PB</span>
          )}
        </div>
      )}
      {trendMs.length > 1 && (
        <SectorSparkline
          label={`${card.label} best per session, oldest to newest`}
          values={trendMs}
          color={CHART_THEME.muted}
        />
      )}
    </div>
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
