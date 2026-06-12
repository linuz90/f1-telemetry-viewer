import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { cardClassCompact } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { CHART_THEME } from "../../utils/colors";
import { msToLapTime } from "../../utils/format";
import { trackFormulaPath } from "./helpers";

export interface QualifyingPaceData {
  track: string;
  formulaKey: string;
  formulaLabel: string;
  showFormula: boolean;
  points: { day: string; bestLap: number }[];
  pbMs: number;
}

export function QualifyingPaceCard({ data }: { data: QualifyingPaceData }) {
  const { track, formulaKey, formulaLabel, showFormula, points, pbMs } = data;
  return (
    <Link
      to={trackFormulaPath(track, formulaKey)}
      className={`${cardClassCompact} !p-3 transition-colors hover:bg-zinc-800/50`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <TrackFlag track={track} />
          <span className="truncate text-sm font-medium">{track}</span>
          {showFormula && (
            <span className="text-[11px] text-zinc-500">{formulaLabel}</span>
          )}
          <span className="ml-1 text-[11px] text-zinc-500">
            {points.length} days
          </span>
        </div>
        <span className="shrink-0 text-sm font-mono text-purple-400">
          {msToLapTime(pbMs)}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={96}>
        <LineChart
          data={points}
          margin={{ top: 5, right: 5, bottom: 0, left: -10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
          <XAxis
            dataKey="day"
            stroke={CHART_THEME.axis}
            fontSize={10}
            tickLine={false}
          />
          <YAxis
            stroke={CHART_THEME.axis}
            fontSize={10}
            tickLine={false}
            tickFormatter={(value: number) => {
              const ms = value * 1000;
              const minutes = Math.floor(ms / 60000);
              const seconds = ((ms % 60000) / 1000).toFixed(1);
              return minutes > 0
                ? `${minutes}:${seconds.padStart(4, "0")}`
                : seconds;
            }}
            domain={["dataMin - 0.5", "dataMax + 0.5"]}
            width={50}
          />
          <Line
            type="monotone"
            dataKey="bestLap"
            stroke={CHART_THEME.best}
            strokeWidth={2}
            dot={{ fill: CHART_THEME.best, r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Link>
  );
}
