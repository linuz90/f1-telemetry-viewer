import { getCompoundColor } from "../../utils/colors";

export function CompoundBadge({ compound }: { compound: string }) {
  const color = getCompoundColor(compound);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-2xs font-semibold text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
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
