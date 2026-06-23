import { Bot, Globe, Monitor, type LucideIcon } from "lucide-react";

export type SessionModeMetaKey = "ai" | "online" | "offline";

export interface SessionModeMeta {
  icon: LucideIcon;
  label: string;
  buttonLabel: string;
  color: string;
}

export const SESSION_MODE_META = {
  ai: {
    icon: Bot,
    label: "AI",
    buttonLabel: "AI filters",
    color: "text-purple-400/70",
  },
  online: {
    icon: Globe,
    label: "Online",
    buttonLabel: "Online filters",
    color: "text-sky-500/70",
  },
  offline: {
    icon: Monitor,
    label: "Offline",
    buttonLabel: "Offline filters",
    color: "text-zinc-500",
  },
} satisfies Record<SessionModeMetaKey, SessionModeMeta>;

export function getSessionModeMeta(mode: SessionModeMetaKey): SessionModeMeta {
  return SESSION_MODE_META[mode];
}
