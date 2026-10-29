import { Flag, Gauge, Timer, type LucideIcon } from "lucide-react";
import type { TrackSessionKind } from "../analysis/trackAnalysis";
import type { BadgeTone } from "./ui/Badge";

/**
 * How a session kind is shown in the lap picker. `color` is the tinted
 * text/icon color; `badgeTone` the matching {@link BadgeTone} for pills.
 */
export interface SessionTypeMeta {
  icon: LucideIcon;
  color: string;
  badgeTone: BadgeTone;
}

/**
 * Meta for a session kind as Track Progress groups them. Qualifying pools
 * Short Quali and One-Shot, so it takes the Timer: the more generic timed
 * cue than One-Shot's Target.
 */
export const TRACK_KIND_META = {
  qualifying: { icon: Timer, color: "text-yellow-500/70", badgeTone: "yellow" },
  race: { icon: Flag, color: "text-red-400/70", badgeTone: "red" },
  "time-trial": { icon: Gauge, color: "text-cyan-400/70", badgeTone: "sky" },
} satisfies Record<TrackSessionKind, SessionTypeMeta>;
