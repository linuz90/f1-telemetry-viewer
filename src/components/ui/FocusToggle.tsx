import { Switch } from "@base-ui/react/switch";

/**
 * "Focus driver only" toggle used above the qualifying and race results tables.
 * Tiny iOS-style switch with a fixed label.
 */
export function FocusToggle({
  value,
  onChange,
  label = "Focus driver only",
}: {
  value: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-tone-400 cursor-pointer select-none">
      {label}
      <Switch.Root
        checked={value}
        onCheckedChange={onChange}
        className="relative inline-flex h-4 w-7 items-center rounded-full bg-tone-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tone-600 data-checked:bg-active"
      >
        {/* The thumb is white in both themes on purpose: a tone token would
            turn it near-black in light mode, which reads as a hole in the
            track rather than a knob. */}
        <Switch.Thumb className="inline-block size-3 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-3.5" />
      </Switch.Root>
    </label>
  );
}
