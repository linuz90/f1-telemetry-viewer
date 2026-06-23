import { type ComponentType } from "react";
import { FileText, Github, Sparkles, Wrench } from "lucide-react";
import changelog from "virtual:changelog";
import { XIcon } from "./ui/icons";
import { Modal } from "./ui/Modal";
import { ScrollArea } from "./ui/ScrollArea";
import {
  AUTHOR_TWITTER_HANDLE,
  AUTHOR_TWITTER_URL,
  REPO_URL,
} from "../constants/links";
import { pullRequestUrl } from "../utils/links";
import { cn } from "../utils/cn";

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
    <Modal onClose={onClose} className="max-w-[680px] max-h-[70vh]">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 pt-5 pb-4 border-b border-white/[0.05] pr-14">
        <h2 className="text-base font-semibold text-zinc-100">What's new</h2>
        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
          <a
            href={AUTHOR_TWITTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
          >
            <XIcon className="h-3 w-3" />
            {AUTHOR_TWITTER_HANDLE}
          </a>
        </div>
      </div>

      {/* Content */}
      <ScrollArea axis="y" className="px-6 py-4 space-y-5">
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
                  <li key={entry.hash} className="flex items-start gap-2.5">
                    {config && (
                      <span
                        className={cn(
                          "shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded",
                          config.bg,
                        )}
                      >
                        <config.icon className={cn("h-3 w-3", config.fg)} />
                      </span>
                    )}
                    <span className="text-sm text-zinc-300 leading-snug">
                      {entry.message}
                      {entry.pr && (
                        <>
                          {" "}
                          <a
                            href={pullRequestUrl(entry.pr)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-2xs leading-none font-medium bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors align-middle"
                          >
                            #{entry.pr}
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </ScrollArea>
    </Modal>
  );
}
