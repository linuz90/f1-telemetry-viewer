import { Eye, Globe, Timer, Target, Flag, Gauge, Save } from "lucide-react";
import { TrackFlag } from "./TrackFlag";
import { isRaceSessionType } from "../utils/sessionTypes";
import { HStack } from "./ui/Stack";

interface SessionCardProps {
  sessionType: string;
  track: string;
  time: string;
  lapIndicators?: ("valid" | "invalid" | "best")[];
  bestLapTime?: string;
  isTrackBest?: boolean;
  aiDifficulty?: number;
  isSpectator?: boolean;
  /** P&G periodic safety-net snapshot — surfaced when not deduped away. */
  isAutoSave?: boolean;
}

const TYPE_CONFIG: Record<string, { color: string; icon: typeof Flag }> = {
  Race: { color: "text-red-400/60", icon: Flag },
  "Short Quali": { color: "text-yellow-500/60", icon: Timer },
  "One-Shot Quali": { color: "text-purple-400/60", icon: Target },
  "Time Trial": { color: "text-cyan-400/60", icon: Gauge },
};

const INDICATOR_COLORS = {
  valid: "bg-emerald-400",
  invalid: "bg-red-400",
  best: "bg-purple-400",
};

export function SessionCard({ sessionType, track, time, lapIndicators, bestLapTime, isTrackBest, aiDifficulty, isSpectator, isAutoSave }: SessionCardProps) {
  const typeConfig =
    TYPE_CONFIG[sessionType] ??
    (isRaceSessionType(sessionType)
      ? TYPE_CONFIG.Race
      : { color: "text-zinc-500", icon: Flag });
  const TypeIcon = typeConfig.icon;

  return (
    <div className="min-w-0">
      <HStack justify="between" className="gap-1.5">
        <HStack as="span" className="gap-1.5 truncate text-sm font-medium">
          <TrackFlag track={track} />
          {track}
        </HStack>
        <HStack className="shrink-0 gap-1.5">
          {isSpectator && (
            <HStack
              as="span"
              className="gap-0.5 text-[10px] font-medium text-zinc-500"
            >
              <Eye className="size-3" />
              Spectator
            </HStack>
          )}
          {isAutoSave && (
            // Surviving auto-saves are ones the dedup pipeline couldn't
            // collapse against a regular save — surfacing the badge makes
            // it obvious why this row exists even when a sibling save
            // doesn't.
            <HStack
              as="span"
              className="gap-0.5 text-[10px] font-medium text-amber-500/70"
              title="Pits n' Giggles periodic auto-save"
            >
              <Save className="size-3" />
              Auto-save
            </HStack>
          )}
          <HStack
            as="span"
            className={`gap-0.5 text-[10px] font-medium uppercase leading-none ${typeConfig.color}`}
          >
            <TypeIcon className="size-3" />
            {sessionType}
          </HStack>
        </HStack>
      </HStack>
      <HStack justify="between" className="mt-0.5 gap-1">
        <HStack className="gap-1">
          <span className="text-xs text-zinc-500">{time}</span>
          {aiDifficulty != null && aiDifficulty > 0 ? (
            <span className="text-[10px] font-medium text-zinc-600">AI {aiDifficulty}</span>
          ) : (
            <HStack
              as="span"
              className="gap-0.5 text-[10px] font-medium text-sky-500/70"
            >
              <Globe className="size-3" />
              Online
            </HStack>
          )}
        </HStack>
        <HStack className="gap-1">
          {lapIndicators && lapIndicators.length > 0 && (
            <HStack as="span" className="gap-0.5">
              {lapIndicators.map((indicator, i) => (
                <span
                  key={i}
                  className={`inline-block size-1.5 rounded-full ${INDICATOR_COLORS[indicator]}`}
                />
              ))}
            </HStack>
          )}
          {bestLapTime && (
            <span className={`text-xs font-mono font-medium ${isTrackBest ? "text-purple-400" : "text-zinc-500"}`}>
              {bestLapTime}
            </span>
          )}
        </HStack>
      </HStack>
    </div>
  );
}
