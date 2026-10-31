import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type {
  DriverData,
  SessionSummary,
  TelemetrySession,
} from "../types/telemetry";
import { useTelemetry } from "../context/TelemetryContext";
import { useScopedSessions } from "./useSessionLog";
import { sessionKind, summaryKind } from "../analysis/sessionKind";
import {
  buildPlayerStintLaps,
  comparableStintPool,
  comparableStints,
  compareStints,
  defaultCompareStint,
  type ComparableStint,
  type StintComparison,
} from "../analysis/stintCompare";
import { findPlayer } from "../utils/stats/drivers";
import { getTrackId } from "../utils/tracks";
import { isRaceSessionType } from "../utils/sessionTypes";
import { formatDayLabel } from "../components/sessions/sessionFormat";

/**
 * Summaries without `stintLaps` (Pits n' Giggles builds its own, demo data is
 * older) load their JSON instead; the newest few are enough for a progression.
 */
const DETAIL_FALLBACK_LIMIT = 6;
/** `?stint=` picks this session's stint by its first lap, `?vs=` what it is
 *  compared with (`slug~startLap`, or `none`). */
const STINT_PARAM = "stint";
const VS_PARAM = "vs";
const NO_COMPARE = "none";

export interface StintCompareModel {
  /** This session's stints. */
  stints: ComparableStint[];
  /** Other sessions' stints here at this race length, oldest first. */
  pool: ComparableStint[];
  /** The pair on screen: one of `stints` and what it is compared with. */
  active: ComparableStint | null;
  compare: ComparableStint | null;
  comparison: StintComparison | null;
  /** Each stint against the latest earlier one on its tyre, when it pairs. */
  defaults: StintComparison[];
  select: (activeId: string, compareId: string | null) => void;
  /** "18:24 run", "Thu 29 Oct race", "L1–9 stint". */
  label: (stint: ComparableStint) => string;
}

const EMPTY: ComparableStint[] = [];

const combineDetails = (
  results: { data?: TelemetrySession }[],
): (TelemetrySession | undefined)[] => results.map((result) => result.data);

export function useStintComparison(
  session: TelemetrySession,
  slug: string,
  driver: DriverData | undefined,
): StintCompareModel {
  const { mode, getSessionQueryOptions } = useTelemetry();
  const scoped = useScopedSessions();
  const [params, setParams] = useSearchParams();
  const meta = scoped.find((s) => s.slug === slug);
  const isPlayer = !!driver?.["is-player"];

  // Without its summary (out of scope) the session still gets its own stints,
  // just nothing to compare them with.
  const date = meta?.date ?? "";
  const stints = useMemo(() => {
    if (!driver || !isPlayer) return EMPTY;
    const stintLaps = buildPlayerStintLaps(session, driver);
    return stintLaps
      ? comparableStints({
          slug,
          date,
          kind: sessionKind(session),
          stintLaps,
        })
      : EMPTY;
  }, [date, driver, isPlayer, session, slug]);
  const raceLaps = stints[0]?.raceLaps;

  const ownUid = sessionUidOf(session) ?? meta?.sessionUid;
  const candidates = useMemo(() => {
    if (!meta || raceLaps == null) return [];
    const trackId = getTrackId(meta.track);
    // Saves of one session are one run: keep its latest save, which ran the
    // most laps (`scoped` is newest first), and none of this session's.
    const seenUids = new Set(ownUid ? [ownUid] : []);
    return scoped.filter((s) => {
      if (
        s.slug === slug ||
        !isRaceSessionType(s.sessionType) ||
        s.isSpectator ||
        s.isSynthetic ||
        getTrackId(s.track) !== trackId ||
        (s.stintLaps?.raceLaps ?? s.playerRaceResult?.totalLaps ?? raceLaps) !==
          raceLaps
      )
        return false;
      if (s.sessionUid) {
        if (seenUids.has(s.sessionUid)) return false;
        seenUids.add(s.sessionUid);
      }
      return true;
    });
  }, [meta, ownUid, raceLaps, scoped, slug]);
  // Earlier runs first, newest first, so the fallback serves the progression
  // and the default comparison before any later run.
  const missing = useMemo(() => {
    const without = candidates.filter((s) => !s.stintLaps);
    const date = meta?.date ?? "";
    return [
      ...without.filter((s) => s.date < date),
      ...without.filter((s) => s.date >= date),
    ].slice(0, DETAIL_FALLBACK_LIMIT);
  }, [candidates, meta?.date]);
  const details = useQueries({
    queries: missing.map((s) => ({
      ...getSessionQueryOptions(s.slug),
      enabled: mode !== "detecting",
    })),
    combine: combineDetails,
  });

  const pool = useMemo(() => {
    if (raceLaps == null) return EMPTY;
    const fromSummaries = candidates.flatMap((s) =>
      s.stintLaps ? fromSummary(s, s.stintLaps) : [],
    );
    const fromDetails = missing.flatMap((s, i) => {
      const detail = details[i];
      // Summaries built elsewhere may lack the UID the JSON carries.
      if (!detail || (ownUid && sessionUidOf(detail) === ownUid)) return [];
      const player = findPlayer(detail);
      const stintLaps = player && buildPlayerStintLaps(detail, player);
      return stintLaps
        ? comparableStints({
            slug: s.slug,
            date: s.date,
            kind: sessionKind(detail),
            stintLaps,
          })
        : [];
    });
    return comparableStintPool({ slug, raceLaps }, [
      ...fromSummaries,
      ...fromDetails,
    ]);
  }, [candidates, missing, details, ownUid, raceLaps, slug]);

  const defaults = useMemo(
    () =>
      stints.flatMap((stint) => {
        const other = defaultCompareStint(stint, pool);
        return other ? [compareStints(stint, other)] : [];
      }),
    [stints, pool],
  );

  // The page opens on the stint with the biggest change, as the headline does.
  const opening = [...defaults].sort(
    (x, y) => Math.abs(y.deltaMs!) - Math.abs(x.deltaMs!),
  )[0];
  const stintParam = Number(params.get(STINT_PARAM));
  const active =
    stints.find((s) => s.startLap === stintParam) ??
    opening?.a ??
    stints[0] ??
    null;
  const vsParam = params.get(VS_PARAM);
  const activeDefault = defaults.find((d) => d.a === active)?.b ?? null;
  const compare =
    vsParam === NO_COMPARE
      ? null
      : ([...stints, ...pool].find(
          (s) => s.id === vsParam && s.id !== active?.id,
        ) ?? activeDefault);
  const comparison = useMemo(
    () => (active && compare ? compareStints(active, compare) : null),
    [active, compare],
  );

  const select = useCallback(
    (activeId: string, compareId: string | null) => {
      const next = new URLSearchParams(params);
      const nextActive = stints.find((s) => s.id === activeId);
      if (nextActive && stints.length > 1)
        next.set(STINT_PARAM, String(nextActive.startLap));
      else next.delete(STINT_PARAM);
      const nextDefault = nextActive
        ? defaults.find((d) => d.a === nextActive)?.b.id
        : undefined;
      // A clean URL for the comparison the page opens with anyway.
      if (compareId === (nextDefault ?? null)) next.delete(VS_PARAM);
      else next.set(VS_PARAM, compareId ?? NO_COMPARE);
      setParams(next, { replace: true });
    },
    [params, setParams, stints, defaults],
  );

  const label = useCallback(
    (stint: ComparableStint) => {
      if (stint.slug === slug)
        return `L${stint.startLap}–${stint.endLap} stint`;
      const word = stint.kind === "long-run" ? "run" : "race";
      const [day, clock = ""] = stint.date.split("T");
      const time = clock.slice(0, 5);
      if (meta && day === meta.date.split("T")[0]) return `${time} ${word}`;
      // Two sessions on one day need the time to tell them apart.
      const sameDay = new Set(
        pool.filter((s) => s.date.startsWith(day)).map((s) => s.slug),
      );
      return sameDay.size > 1
        ? `${formatDayLabel(day)} ${time} ${word}`
        : `${formatDayLabel(day)} ${word}`;
    },
    [meta, pool, slug],
  );

  return {
    stints,
    pool,
    active,
    compare,
    comparison,
    defaults,
    select,
    label,
  };
}

/** Pits n' Giggles' session identity, an opaque string (the number can exceed
 *  JS's safe integers), as `SessionSummary.sessionUid` stores it. */
function sessionUidOf(session: TelemetrySession): string | undefined {
  const uid = session.debug?.["session-uid"];
  return uid == null ? undefined : String(uid);
}

function fromSummary(
  summary: SessionSummary,
  stintLaps: NonNullable<SessionSummary["stintLaps"]>,
): ComparableStint[] {
  return comparableStints({
    slug: summary.slug,
    date: summary.date,
    kind: summaryKind(summary),
    stintLaps,
  });
}
