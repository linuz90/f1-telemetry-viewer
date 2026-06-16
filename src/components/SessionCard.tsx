import { Eye, Globe, Save } from "lucide-react";
import { cn } from "../utils/cn";
import { TrackFlag } from "./TrackFlag";
import { getSessionTypeMeta } from "./sessionTypeMeta";
import { HStack } from "./ui/Stack";

interface SessionCardProps {
  sessionType: string;
  track: string;
  time: string;
  lapIndicators?: ("valid" | "invalid" | "best")[];
  bestLapTime?: string;
  isTrackBest?: boolean;
  aiDifficulty?: number;
  isOnline?: boolean;
  isSpectator?: boolean;
  /** P&G periodic safety-net snapshot — surfaced when not deduped away. */
  isAutoSave?: boolean;
  /** When true, the date header already shows the AI/Online context — omit it from the row. */
  hideMode?: boolean;
}

const INDICATOR_COLORS = {
  valid: "bg-emerald-400",
  invalid: "bg-red-400",
  best: "bg-purple-400",
};

export function SessionCard({
  sessionType,
  track,
  time,
  lapIndicators,
  bestLapTime,
  isTrackBest,
  aiDifficulty,
  isOnline,
  isSpectator,
  isAutoSave,
  hideMode,
}: SessionCardProps) {
  const typeMeta = getSessionTypeMeta(sessionType);
  const TypeIcon = typeMeta.icon;

  return (
    <div className="min-w-0">
      <HStack justify="between" className="gap-1.5">
        <HStack as="span" className="min-w-0 gap-1.5 truncate text-sm font-medium">
          <TrackFlag track={track} />
          <span className="truncate">{track}</span>
        </HStack>
        <HStack className="shrink-0 gap-1.5">
          {isAutoSave && (
            // Surviving auto-saves are ones the dedup pipeline couldn't
            // collapse against a regular save — surfacing the badge makes
            // it obvious why this row exists even when a sibling save
            // doesn't.
            <HStack
              as="span"
              className="gap-0.5 text-2xs font-medium text-amber-500/70"
              title="Pits n' Giggles periodic auto-save"
            >
              <Save className="size-3" />
              Auto-save
            </HStack>
          )}
          <HStack
            as="span"
            className={cn("gap-0.5 text-2xs font-medium uppercase leading-none", typeMeta.color)}
          >
            <TypeIcon className="size-3" />
            {sessionType}
          </HStack>
        </HStack>
      </HStack>
      <HStack justify="between" className="mt-0.5 gap-1">
        <HStack className="shrink-0 gap-1">
          <span className="text-xs text-zinc-500">{time}</span>
          {!hideMode && aiDifficulty != null && aiDifficulty > 0 && (
            <span className="text-2xs font-medium text-zinc-600">
              AI {aiDifficulty}
            </span>
          )}
          {!hideMode && isOnline === true && (
            <HStack
              as="span"
              className="gap-0.5 text-2xs font-medium text-sky-500/70"
            >
              <Globe className="size-3" />
              Online
            </HStack>
          )}
        </HStack>
        <HStack className="min-w-0 flex-1 justify-end gap-1">
          {isSpectator && (
            <HStack
              as="span"
              className="shrink-0 gap-0.5 text-2xs font-medium text-zinc-500"
            >
              <Eye className="size-3" />
              Spectator
            </HStack>
          )}
          {lapIndicators && lapIndicators.length > 0 && (
            // Time trials can pile up 30+ laps. Keep each dot at its full
            // size and clip the earliest ones on the left when they don't
            // fit, with a fade mask so the cut-off edge doesn't show a
            // sliced half-dot.
            <HStack
              as="span"
              className="min-w-0 flex-1 justify-end gap-0.5 overflow-hidden"
              style={{
                maskImage:
                  "linear-gradient(to right, transparent 0, black 12px)",
                WebkitMaskImage:
                  "linear-gradient(to right, transparent 0, black 12px)",
              }}
            >
              {lapIndicators.map((indicator, i) => (
                <span
                  key={i}
                  className={cn("inline-block size-1.5 shrink-0 rounded-full", INDICATOR_COLORS[indicator])}
                />
              ))}
            </HStack>
          )}
          {bestLapTime && (
            <span className={cn("shrink-0 text-xs font-mono font-medium", isTrackBest ? "text-purple-400" : "text-zinc-500")}>
              {bestLapTime}
            </span>
          )}
        </HStack>
      </HStack>
    </div>
  );
}
