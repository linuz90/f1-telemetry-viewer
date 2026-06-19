import { getCompoundColor } from "../../utils/colors";
import { dynamicAccentCardStyle } from "../Card";

export function CompoundBadge({ compound }: { compound: string }) {
  const color = getCompoundColor(compound);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-2xs font-semibold text-zinc-100"
      style={dynamicAccentCardStyle(color)}
      title={compound}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 10px ${color}66`,
        }}
      />
      {compound}
    </span>
  );
}
