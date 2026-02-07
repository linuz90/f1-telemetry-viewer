import type { ReactNode } from "react";
import { getCompoundColor } from "../utils/colors";

interface CompoundStatCardRow {
  label: string;
  value: string;
  className?: string;
}

interface CompoundStatCardProps {
  compound: string;
  rows: CompoundStatCardRow[];
  /** Large hero number displayed prominently above the rows */
  hero?: { value: string; label: string };
  progress?: { ratio: number };
  children?: ReactNode;
}

export function CompoundStatCard({ compound, rows, hero, progress, children }: CompoundStatCardProps) {
  const color = getCompoundColor(compound);

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-medium text-zinc-300 truncate">
          {compound}
        </span>
      </div>
      {hero && (
        <div className="text-center py-2 mb-1.5">
          <div className="font-mono text-2xl font-semibold text-zinc-100">
            {hero.value}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{hero.label}</div>
        </div>
      )}
      <div className="text-xs text-zinc-400 space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex justify-between">
            <span>{row.label}</span>
            <span className={row.className ?? "text-zinc-300 font-mono"}>
              {row.value}
            </span>
          </div>
        ))}
        {progress && (
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(Math.round(progress.ratio * 100), 100)}%`,
                backgroundColor:
                  progress.ratio > 0.8 ? "#ef4444" :
                  progress.ratio > 0.6 ? "#f59e0b" :
                  "#22c55e",
              }}
            />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
