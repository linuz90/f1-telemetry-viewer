import type { SessionSummary } from "../types/telemetry";

const DUPLICATE_WINDOW_MS = 30_000;

type WithFileSize = SessionSummary & { fileSize: number };

/**
 * Remove duplicate sessions caused by auto-save + manual-save within seconds.
 * When two sessions share the same type, track, and lap count and are within
 * 30 s of each other, keep the larger file (more complete telemetry).
 * The surviving session gets a `duplicateCount` reflecting how many were merged.
 */
export function deduplicateSessions<T extends WithFileSize>(sessions: T[]): T[] {
  const getDuplicateCount = (session: T) =>
    dupeCount.get(session) ?? session.duplicateCount ?? 0;

  // Group by identity key
  const groups = new Map<string, T[]>();
  for (const s of sessions) {
    const key = `${s.sessionType}|${s.track}|${s.validLapCount}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(s);
  }

  const removed = new Set<T>();
  const dupeCount = new Map<T, number>();

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Sort by date ascending within group
    group.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Compare each survivor with the next non-removed item
    // Using a "current keeper" approach to handle chains (A, B, C all within 30s)
    let keeper = group[0];
    for (let i = 1; i < group.length; i++) {
      if (removed.has(keeper)) {
        keeper = group[i];
        continue;
      }

      const candidate = group[i];
      const delta = new Date(candidate.date).getTime() - new Date(keeper.date).getTime();
      if (delta <= DUPLICATE_WINDOW_MS) {
        // Keep the larger file; on tie keep the later one (manual save)
        const drop = keeper.fileSize > candidate.fileSize ? candidate : keeper;
        const keep = drop === keeper ? candidate : keeper;
        const mergedCount = getDuplicateCount(keep) + getDuplicateCount(drop) + 1;
        removed.add(drop);
        dupeCount.set(keep, mergedCount);
        keeper = keep;
      } else {
        keeper = candidate;
      }
    }
  }

  // Preserve original order, annotate survivors
  return sessions
    .filter((s) => !removed.has(s))
    .map((s) => {
      const count = dupeCount.get(s) ?? s.duplicateCount;
      return count ? { ...s, duplicateCount: count } : s;
    });
}
