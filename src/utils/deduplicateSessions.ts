import type { SessionSummary } from "../types/telemetry";

/**
 * Session list dedup pipeline
 * ===========================
 *
 * Pits n' Giggles writes the same on-track session to disk in several ways:
 *
 *   1. The user can hit "Save now" and produce a regular save.
 *   2. The tool itself writes a periodic `Just_in_case_…` auto-save snapshot
 *      every few minutes as a safety net for game crashes.
 *
 * Both routes can produce overlapping files for the same stint, and the
 * raw on-disk list ends up cluttered with near-identical entries. This
 * module collapses the noise in two passes, in order:
 *
 *   Rule A — "30-second window" (handles save-now + autosave at the same
 *            instant, or rapid back-to-back regular saves)
 *
 *     Group by an exact identity key (game year, packet format, formula,
 *     session type, track, valid lap count). Within each group, sort by
 *     date and walk forward: any two saves within 30 s are merged, keeping
 *     the larger file (more complete telemetry). Ties prefer the later one.
 *     Applies to both auto- and manual saves — useful when the auto-save
 *     fired moments before the user manually saved the same stint.
 *
 *   Rule B — "Auto-save dominance" (handles partial auto-save snapshots
 *            taken mid-session that a later save fully supersedes)
 *
 *     Auto-saves are written incrementally, so the most recent save almost
 *     always represents at least as much running as the earlier ones. We
 *     hide an auto-save iff some other save in the same broad bucket
 *     (track, sessionType, formula, gameYear, calendar day) has:
 *         best lap time <= the auto-save's   (equally fast or faster)
 *       AND
 *         valid lap count >= the auto-save's (at least as many laps)
 *     A *regular* (manual) save is never hidden by this rule — manual
 *     saves are intentional and we always show them. If only auto-saves
 *     exist in a bucket, we keep the latest one (by date) and hide the
 *     earlier auto-saves it dominates.
 *
 * Each hidden save bumps the surviving session's `duplicateCount`, which
 * powers the `DuplicateNotice` in the session detail page.
 */

/** Window for Rule A — see header comment. */
const DUPLICATE_WINDOW_MS = 30_000;

type WithFileSize = SessionSummary & { fileSize: number };

export function deduplicateSessions<T extends WithFileSize>(sessions: T[]): T[] {
  // Shared state: which inputs are dropped, and how many drops "belong to"
  // each surviving session (so we can show "N duplicate saves hidden").
  const removed = new Set<T>();
  const dupeCount = new Map<T, number>();
  const getDupes = (session: T) =>
    dupeCount.get(session) ?? session.duplicateCount ?? 0;
  const recordDrop = (keep: T, drop: T) => {
    // The dropped session may itself have accumulated duplicates from a
    // prior pass (Rule A → Rule B) or from input data; carry the total.
    const merged = getDupes(keep) + getDupes(drop) + 1;
    dupeCount.set(keep, merged);
    removed.add(drop);
  };

  applyTimeWindowRule(sessions, removed, recordDrop);
  applyAutoSaveDominanceRule(sessions, removed, recordDrop);

  // Preserve the caller's order and annotate survivors with the (possibly
  // updated) duplicate count.
  return sessions
    .filter((s) => !removed.has(s))
    .map((s) => {
      const count = dupeCount.get(s) ?? s.duplicateCount;
      return count ? { ...s, duplicateCount: count } : s;
    });
}

// ---------------------------------------------------------------------------
// Rule A — 30-second window
// ---------------------------------------------------------------------------

function applyTimeWindowRule<T extends WithFileSize>(
  sessions: T[],
  removed: Set<T>,
  recordDrop: (keep: T, drop: T) => void,
): void {
  // Identity key: anything that should be treated as "literally the same
  // stint, saved twice". Valid lap count is part of the key so an auto-save
  // mid-session (fewer laps) doesn't collapse with the final save.
  const groups = new Map<string, T[]>();
  for (const s of sessions) {
    if (removed.has(s)) continue;
    const key = [
      s.gameYear ?? "",
      s.packetFormat ?? "",
      s.formula ?? "",
      s.sessionType,
      s.track,
      s.validLapCount,
    ].join("|");
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Ascending so we can walk the timeline and merge chains
    // (A → B → C all within 30 s of each neighbour).
    group.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let keeper = group[0];
    for (let i = 1; i < group.length; i++) {
      if (removed.has(keeper)) {
        keeper = group[i];
        continue;
      }
      const candidate = group[i];
      const delta =
        new Date(candidate.date).getTime() - new Date(keeper.date).getTime();
      if (delta <= DUPLICATE_WINDOW_MS) {
        // Larger file wins (more complete telemetry); ties favour the later
        // save, which tends to be the user's intentional manual save fired
        // moments after the auto-save snapshot.
        const drop = keeper.fileSize > candidate.fileSize ? candidate : keeper;
        const keep = drop === keeper ? candidate : keeper;
        recordDrop(keep, drop);
        keeper = keep;
      } else {
        keeper = candidate;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule B — auto-save dominance
// ---------------------------------------------------------------------------

/**
 * A save X "dominates" auto-save Y iff X is at least as fast AND ran at
 * least as many valid laps. Equality counts as dominance — that's exactly
 * the case we want to collapse (the later auto-save matches/exceeds the
 * earlier snapshot on both axes).
 */
function dominates<T extends WithFileSize>(x: T, y: T): boolean {
  // Treat missing best-lap as "infinity" so a session without any timed
  // lap can't dominate one that has a recorded best.
  const xBest = x.bestLapTimeMs ?? Number.POSITIVE_INFINITY;
  const yBest = y.bestLapTimeMs ?? Number.POSITIVE_INFINITY;
  return xBest <= yBest && x.validLapCount >= y.validLapCount;
}

function applyAutoSaveDominanceRule<T extends WithFileSize>(
  sessions: T[],
  removed: Set<T>,
  recordDrop: (keep: T, drop: T) => void,
): void {
  // Broad bucket: same track + session type + formula + game year, on the
  // same calendar day. We deliberately do NOT key on lap count here — the
  // whole point is to compare snapshots taken at different progress points.
  const buckets = new Map<string, T[]>();
  for (const s of sessions) {
    if (removed.has(s)) continue;
    const day = s.date.split("T")[0] ?? s.date;
    const key = [
      s.gameYear ?? "",
      s.formula ?? "",
      s.sessionType,
      s.track,
      day,
    ].join("|");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(s);
    else buckets.set(key, [s]);
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    const hasRegular = bucket.some((s) => !s.isAutoSave);

    // Newest first — useful both for the tiebreaker (we want the latest
    // auto-save to survive when there's no regular save) and so the loop
    // body has a natural "compare against everyone else newer or equal".
    bucket.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    for (const candidate of bucket) {
      if (removed.has(candidate)) continue;
      // Never hide a regular save with this rule — manual saves are
      // intentional, and the user expects to see them all.
      if (!candidate.isAutoSave) continue;

      const candidateTime = new Date(candidate.date).getTime();

      // Build the eligibility filter for dominators.
      //
      // * If the bucket contains a regular save, only regular saves are
      //   allowed to dominate. Manual saves are the canonical record, so
      //   we don't want one auto-save to remove another while a manual
      //   save is doing that job; the manual save will get whichever
      //   auto-saves it actually dominates.
      // * Otherwise (auto-saves only), an auto-save can only be dominated
      //   by a *later* auto-save. This implements the "keep the latest"
      //   tiebreak: walking newest-first, an older auto-save sees the
      //   newer one as its dominator, but the newest one finds nothing
      //   newer than itself and therefore survives.
      const isEligible = (other: T) => {
        if (other === candidate || removed.has(other)) return false;
        if (!dominates(other, candidate)) return false;
        if (hasRegular) return !other.isAutoSave;
        return new Date(other.date).getTime() > candidateTime;
      };

      // Of all eligible dominators, attribute the hidden save to the
      // *temporally closest* one — that's the regular save most likely to
      // represent the same attempt, so the per-session "N saves hidden"
      // counter on the survivor matches the user's mental model.
      let dominator: T | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const other of bucket) {
        if (!isEligible(other)) continue;
        const distance = Math.abs(new Date(other.date).getTime() - candidateTime);
        if (distance < bestDistance) {
          bestDistance = distance;
          dominator = other;
        }
      }

      if (dominator) {
        recordDrop(dominator, candidate);
      }
    }
  }
}
