import { Flag, Gauge, Target, Timer, type LucideIcon } from "lucide-react";
import type { BadgeTone } from "./ui/Badge";
import {
  isQualifyingSessionType,
  isRaceSessionType,
  isTimeTrialSessionType,
} from "../utils/sessionTypes";

/**
 * Single source of truth for how a session type is shown across surfaces
 * (sidebar SessionCard, dashboard ActivityRow). Keyed by the display label
 * returned by `formatSessionType()` so callers can pass either the raw
 * session-type string or the formatted label — both resolve consistently.
 *
 * `color` is the tinted text/icon color used in the plain sidebar style.
 * `badgeTone` is the matching {@link BadgeTone} for filled-pill surfaces.
 */
export interface SessionTypeMeta {
  icon: LucideIcon;
  color: string;
  badgeTone: BadgeTone;
}

const FALLBACK: SessionTypeMeta = {
  icon: Flag,
  color: "text-zinc-500",
  badgeTone: "zinc",
};

const META: Record<string, SessionTypeMeta> = {
  Race: { icon: Flag, color: "text-red-400/70", badgeTone: "red" },
  Sprint: { icon: Flag, color: "text-red-400/70", badgeTone: "red" },
  "Feature Race": { icon: Flag, color: "text-red-400/70", badgeTone: "red" },
  "Short Qualifying": {
    icon: Timer,
    color: "text-yellow-500/70",
    badgeTone: "yellow",
  },
  "Short Quali": {
    icon: Timer,
    color: "text-yellow-500/70",
    badgeTone: "yellow",
  },
  "Short Sprint Shootout": {
    icon: Timer,
    color: "text-yellow-500/70",
    badgeTone: "yellow",
  },
  "Sprint Shootout": {
    icon: Timer,
    color: "text-yellow-500/70",
    badgeTone: "yellow",
  },
  "Short Session Shootout": {
    icon: Timer,
    color: "text-yellow-500/70",
    badgeTone: "yellow",
  },
  "Session Shootout": {
    icon: Timer,
    color: "text-yellow-500/70",
    badgeTone: "yellow",
  },
  "One Shot Qualifying": {
    icon: Target,
    color: "text-purple-400/70",
    badgeTone: "purple",
  },
  "One-Shot Quali": {
    icon: Target,
    color: "text-purple-400/70",
    badgeTone: "purple",
  },
  "Time Trial": { icon: Gauge, color: "text-cyan-400/70", badgeTone: "sky" },
};

export const SESSION_TYPE_FILTER_META = {
  race: { ...META.Race, label: "Race", buttonLabel: "Race filters" },
  quali: {
    ...META["Short Quali"],
    label: "Quali",
    buttonLabel: "Qualifying filters",
  },
  tt: {
    ...META["Time Trial"],
    label: "TT",
    buttonLabel: "Time Trial filters",
  },
} satisfies Record<
  "race" | "quali" | "tt",
  SessionTypeMeta & { label: string; buttonLabel: string }
>;

export function getSessionTypeMeta(label: string): SessionTypeMeta {
  const explicit = META[label];
  if (explicit) return explicit;
  // Catch raw "Race"/"Race 2" strings (and any future race variants) when
  // callers pass the raw session-type instead of the formatted label.
  if (isRaceSessionType(label)) return META.Race;
  if (isQualifyingSessionType(label)) return META["Short Quali"];
  if (isTimeTrialSessionType(label)) return META["Time Trial"];
  return FALLBACK;
}
