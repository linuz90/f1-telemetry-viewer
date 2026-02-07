import type { ComponentType } from "react";
import { FileText, Github, Sparkles, Wrench, X } from "lucide-react";
import changelog from "virtual:changelog";

const REPO_URL = "https://github.com/linuz90/f1-telemetry-viewer";

const TYPE_CONFIG: Record<
  string,
  { icon: ComponentType<{ className?: string }>; bg: string; fg: string }
> = {
  feat: { icon: Sparkles, bg: "bg-emerald-500/15", fg: "text-emerald-400" },
  fix: { icon: Wrench, bg: "bg-amber-500/15", fg: "text-amber-400" },
  docs: { icon: FileText, bg: "bg-blue-500/15", fg: "text-blue-400" },
};

function groupByDate(
  entries: typeof changelog,
): Record<string, typeof changelog> {
  const groups: Record<string, typeof changelog> = {};
  for (const entry of entries) {
    (groups[entry.date] ??= []).push(entry);
  }
  return groups;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const grouped = groupByDate(changelog);
  const dates = Object.keys(grouped);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-lg max-h-[70vh] flex-col rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-100">
              What's new
            </h2>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="View on GitHub"
            >
              <Github className="h-3.5 w-3.5" />
            </a>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-6 py-4 space-y-5">
          {dates.length === 0 && (
            <p className="text-sm text-zinc-500">No changelog available.</p>
          )}
          {dates.map((date) => (
            <div key={date}>
              <h3 className="text-xs font-medium text-zinc-500 mb-2">
                {formatDate(date)}
              </h3>
              <ul className="space-y-1.5">
                {grouped[date].map((entry) => {
                  const config = TYPE_CONFIG[entry.type];
                  return (
                    <li key={entry.hash} className="flex items-center gap-2.5">
                      {config && (
                        <span
                          className={`shrink-0 flex h-5 w-5 items-center justify-center rounded ${config.bg}`}
                        >
                          <config.icon className={`h-3 w-3 ${config.fg}`} />
                        </span>
                      )}
                      <span className="text-sm text-zinc-300 leading-snug">
                        {entry.message}
                      </span>
                      {entry.pr && (
                        <a
                          href={`${REPO_URL}/pull/${entry.pr}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
                        >
                          PR
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
