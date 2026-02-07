import type { Plugin } from "vite";
import { execSync } from "child_process";

export interface ChangelogEntry {
  hash: string;
  date: string;
  type: string;
  message: string;
}

const VISIBLE_TYPES = new Set(["feat", "fix", "docs"]);
const VIRTUAL_ID = "virtual:changelog";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function getChangelog(): ChangelogEntry[] {
  try {
    const raw = execSync(
      'git log --format="%H|%aI|%s" --no-merges',
      { encoding: "utf-8", maxBuffer: 1024 * 1024 },
    );

    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, dateISO, ...rest] = line.split("|");
        const subject = rest.join("|");
        const date = dateISO.slice(0, 10); // YYYY-MM-DD

        // Parse conventional commit prefix
        const match = subject.match(/^(\w+)(?:\(.+?\))?:\s*(.+)$/);
        const type = match?.[1] ?? "other";
        const message = match?.[2] ?? subject;

        return { hash: hash.slice(0, 7), date, type, message };
      })
      .filter((e) => VISIBLE_TYPES.has(e.type));
  } catch {
    return [];
  }
}

export function changelogPlugin(): Plugin {
  let data: ChangelogEntry[] = [];

  return {
    name: "changelog",

    buildStart() {
      data = getChangelog();
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(data)};`;
      }
    },
  };
}
