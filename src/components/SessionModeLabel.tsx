import { cn } from "../utils/cn";
import { resolveSessionMode, SESSION_MODE_META } from "./sessionModeMeta";

interface SessionModeLabelProps {
  isOnline?: boolean;
  aiDifficulty?: number;
  showOffline?: boolean;
  className?: string;
}

/** Compact mode marker shared by sidebar cards and session-history metadata. */
export function SessionModeLabel({
  isOnline,
  aiDifficulty,
  showOffline = false,
  className,
}: SessionModeLabelProps) {
  const mode = resolveSessionMode(isOnline, aiDifficulty, showOffline);
  if (!mode) return null;

  const meta = SESSION_MODE_META[mode.key];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-2xs font-medium",
        meta.color,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" />
      {mode.label}
    </span>
  );
}
