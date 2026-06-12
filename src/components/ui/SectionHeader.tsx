/**
 * Section header with a fading right-side rule.
 * Used to introduce sub-sections inside a page (e.g. "Qualifying Progress").
 */
export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h3>
      <div className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent" />
    </div>
  );
}
