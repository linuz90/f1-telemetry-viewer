import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "../../utils/cn";
import { CHART_THEME } from "../../constants/colors";
import { msToLapTime } from "../../utils/format";
import { cardClassCompact } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { HStack } from "../ui/Stack";
import { trackFormulaPath } from "./helpers";

export interface QualifyingPaceData {
  track: string;
  formulaKey: string;
  formulaLabel: string;
  points: { day: string; bestLap: number }[];
  pbMs: number;
}

export function QualifyingPaceCard({ data }: { data: QualifyingPaceData }) {
  const { track, formulaKey, points, pbMs } = data;
  return (
    <Link
      to={trackFormulaPath(track, formulaKey)}
      className={cn(cardClassCompact, "transition-colors hover:bg-zinc-800/50")}
    >
      <HStack justify="between" className="mb-2 gap-3">
        <HStack className="gap-1.5">
          <TrackFlag track={track} />
          <span className="truncate text-sm font-medium">{track}</span>
          <span className="ml-1 font-mono text-xs tabular-nums text-zinc-500">
            {points.length} days
          </span>
        </HStack>
        <span className="shrink-0 text-sm font-mono text-purple-400">
          {msToLapTime(pbMs)}
        </span>
      </HStack>
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
