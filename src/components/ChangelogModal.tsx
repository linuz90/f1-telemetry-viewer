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

// Neutral glyphs: the type is a scanning aid, and green/amber carry gain and
// warning meanings elsewhere in the app.
const TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  feat: Sparkles,
  fix: Wrench,
  docs: FileText,
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
    <Modal
      onClose={onClose}
      title="What's new"
      className="max-h-[70vh] max-w-xl"
      footer={
        <div className="flex items-center gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-tone-200"
          >
            <Github className="size-3.5" />
            GitHub
          </a>
          <a
            href={AUTHOR_TWITTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-tone-200"
          >
            <XIcon className="size-3" />
            {AUTHOR_TWITTER_HANDLE}
          </a>
        </div>
      }
    >
      <ScrollArea axis="y" className="min-h-0 space-y-5 px-5 pb-5">
        {dates.length === 0 && (
          <p className="text-sm text-tone-500">No changelog available.</p>
        )}
        {dates.map((date) => (
          <section key={date}>
            <h3 className="mb-1.5 text-xs font-medium text-tone-500">
              {formatDate(date)}
            </h3>
            <ul className="space-y-1">
              {grouped[date].map((entry) => {
                const Icon = TYPE_ICONS[entry.type];
                return (
                  <li key={entry.hash} className="flex items-start gap-2.5">
                    <span className="mt-[3px] size-3.5 shrink-0 text-tone-500">
                      {Icon && <Icon className="size-3.5" />}
                    </span>
                    {/* Commit subjects are lowercase; a flex item is a block,
                        so first-letter can capitalise them here. */}
                    <span className="min-w-0 flex-1 text-sm leading-snug text-tone-300 first-letter:uppercase">
                      {entry.message}
                      {entry.pr && (
                        <>
                          {" "}
                          <a
                            href={pullRequestUrl(entry.pr)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-tone-600 tabular-nums transition-colors hover:text-tone-300"
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
          </section>
        ))}
      </ScrollArea>
    </Modal>
  );
}
