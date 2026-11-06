import { Flag, Gauge, Timer, type LucideIcon } from "lucide-react";
import type { SessionKind } from "../analysis/sessionKind";
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

/**
 * The same glyphs by `summaryKind()`. A long run is a race save cut short, and
 * the track page files it under races, so it keeps the flag.
 */
export const SESSION_KIND_ICON: Record<SessionKind, LucideIcon> = {
  race: TRACK_KIND_META.race.icon,
  "long-run": TRACK_KIND_META.race.icon,
  qualifying: TRACK_KIND_META.qualifying.icon,
  "time-trial": TRACK_KIND_META["time-trial"].icon,
};
