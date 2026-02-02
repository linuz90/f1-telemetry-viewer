import { Globe, Timer, Target, Flag } from "lucide-react";
import { getTrackFlag } from "../utils/format";

interface SessionCardProps {
  sessionType: string;
  track: string;
  time: string;
  lapIndicators?: ("valid" | "invalid" | "best")[];
  bestLapTime?: string;
  isTrackBest?: boolean;
  aiDifficulty?: number;
}

const TYPE_CONFIG: Record<string, { color: string; icon: typeof Flag }> = {
  Race: { color: "text-red-400/60", icon: Flag },
  "Short Quali": { color: "text-yellow-500/60", icon: Timer },
  "One-Shot Quali": { color: "text-purple-400/60", icon: Target },
};

const INDICATOR_COLORS = {
  valid: "bg-emerald-400",
  invalid: "bg-red-400",
  best: "bg-purple-400",
};

export function SessionCard({ sessionType, track, time, lapIndicators, bestLapTime, isTrackBest, aiDifficulty }: SessionCardProps) {
  const typeConfig = TYPE_CONFIG[sessionType] ?? { color: "text-zinc-500", icon: Flag };
  const TypeIcon = typeConfig.icon;

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-sm font-medium truncate">{getTrackFlag(track)} {track}</span>
        <span className={`shrink-0 flex items-center gap-0.5 text-[10px] font-medium uppercase leading-none ${typeConfig.color}`}>
          <TypeIcon className="size-3" />
          {sessionType}
        </span>
      </div>
      <div className="flex items-center justify-between gap-1 mt-0.5">
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500">{time}</span>
          {aiDifficulty != null && aiDifficulty > 0 ? (
            <span className="text-[10px] font-medium text-zinc-600">AI {aiDifficulty}</span>
          ) : (
            <span className="flex items-center gap-0.5 text-[10px] font-medium text-sky-500/70"><Globe className="size-3" />Online</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {lapIndicators && lapIndicators.length > 0 && (
            <span className="flex items-center gap-0.5">
              {lapIndicators.map((indicator, i) => (
                <span
                  key={i}
                  className={`inline-block size-1.5 rounded-full ${INDICATOR_COLORS[indicator]}`}
                />
              ))}
            </span>
          )}
          {bestLapTime && (
            <span className={`text-xs font-mono font-medium ${isTrackBest ? "text-purple-400" : "text-zinc-500"}`}>
              {bestLapTime}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
