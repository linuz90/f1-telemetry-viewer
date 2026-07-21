import { Bot, Globe, Monitor, type LucideIcon } from "lucide-react";

export type SessionModeMetaKey = "ai" | "online" | "offline";

export interface SessionModeMeta {
  icon: LucideIcon;
  label: string;
  buttonLabel: string;
  color: string;
}

export interface ResolvedSessionMode {
  key: SessionModeMetaKey;
  label: string;
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

/**
 * Resolve the user-facing mode from normalized summary fields. Online must win
 * over AI because older/raw exports can retain an AI difficulty in online
 * sessions even though that value does not describe the lobby.
 */
export function resolveSessionMode(
  isOnline: boolean | undefined,
  aiDifficulty: number | undefined,
  includeOffline = false,
): ResolvedSessionMode | null {
  if (isOnline === true) return { key: "online", label: "Online" };
  if (aiDifficulty != null && aiDifficulty > 0) {
    return { key: "ai", label: `AI ${aiDifficulty}` };
  }
  return includeOffline ? { key: "offline", label: "Offline" } : null;
}
