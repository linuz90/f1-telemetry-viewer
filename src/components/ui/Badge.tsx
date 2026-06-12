export type BadgeTone = "red" | "amber" | "green" | "sky" | "zinc";

const TONE: Record<BadgeTone, string> = {
  red: "bg-red-500/10 text-red-400",
  amber: "bg-amber-500/10 text-amber-300",
  green: "bg-green-500/10 text-green-400",
  sky: "bg-sky-500/10 text-sky-300",
  zinc: "bg-zinc-800/80 text-zinc-400",
};

/**
 * Small rounded-pill status badge — uppercase counts, alerts, tags.
 * For neutral metadata chips (e.g. formula labels), prefer a plain `<span>`.
 */
export function Badge({
  tone = "zinc",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[tone]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}
