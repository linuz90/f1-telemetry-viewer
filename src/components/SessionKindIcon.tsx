import type { SessionKind } from "../analysis/sessionKind";
import { cn } from "../utils/cn";
import { SESSION_KIND_ICON } from "./sessionTypeMeta";

/**
 * A session kind's glyph, sized to sit inline with the text it labels: 1em
 * square on the text baseline, in the text's color unless a class overrides
 * it. Pass `label` when the glyph stands alone, without the kind's name.
 */
export function SessionKindIcon({
  kind,
  label,
  className,
}: {
  kind: SessionKind;
  label?: string;
  className?: string;
}) {
  const Icon = SESSION_KIND_ICON[kind];
  return (
    <Icon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      className={cn(
        "inline-block size-[1em] shrink-0 align-[-0.125em]",
        className,
      )}
    >
      {label && <title>{label}</title>}
    </Icon>
  );
}
