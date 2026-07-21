import { formatSessionType } from "../utils/format";
import { cn } from "../utils/cn";
import { getSessionTypeMeta } from "./sessionTypeMeta";
import { Badge } from "./ui/Badge";

interface SessionTypeBadgeProps {
  sessionType: string;
  formula?: string;
  className?: string;
}

/** Shared colored session-type identity used by full-width session rows. */
export function SessionTypeBadge({
  sessionType,
  formula,
  className,
}: SessionTypeBadgeProps) {
  const label = formatSessionType(sessionType, formula);
  const meta = getSessionTypeMeta(label);
  const Icon = meta.icon;

  return (
    <Badge tone={meta.badgeTone} className={cn("shrink-0 gap-1", className)}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}
