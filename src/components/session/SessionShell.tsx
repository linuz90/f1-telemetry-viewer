import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { SessionSummary, TelemetrySession } from "../../types/telemetry";
import { useTelemetry } from "../../context/TelemetryContext";
import { useScopedSessions, useSessionLog } from "../../hooks/useSessionLog";
import {
  sessionRowLabel,
  summaryKind,
  type SessionKind,
} from "../../analysis/sessionKind";
import { sessionBestLapMs, sessionDayKey } from "../../analysis/sessionLog";
import { LAPS_QUERY_PARAM } from "../../analysis/lapTelemetrySelection";
import { sessionSaveSlugs } from "../../utils/deduplicateSessions";
import { SESSION_TAB_QUERY_PARAM } from "../../constants/routes";
import { getTrackDisplayName, getTrackId } from "../../utils/tracks";
import { formatSessionType, msToLapTime } from "../../utils/format";
import {
  dashboardPath,
  sessionSummaryPath,
  trackPath,
  trackTabForSessionType,
} from "../../utils/routes";
import { cn } from "../../utils/cn";
import { TrackFlag } from "../TrackFlag";
import {
  formatDayLabel,
  sessionClock,
  sessionResult,
} from "../sessions/sessionFormat";

export interface SessionTab<K extends string = string> {
  key: K;
  label: string;
}

/**
 * The open tab lives in `?tab=` so a tab can be linked and survives reloads.
 * A lap selection (`?laps=`) without a tab is a link into Lap telemetry, the
 * only tab that reads it.
 */
export function useSessionTab<K extends string>(
  tabs: readonly SessionTab<K>[],
): [K, (tab: K) => void] {
  const [params, setParams] = useSearchParams();
  const hasLapRefs =
    params.has(LAPS_QUERY_PARAM) && tabs.some((t) => t.key === "lap-telemetry");
  const requested = (params.get(SESSION_TAB_QUERY_PARAM) ??
    (hasLapRefs ? "lap-telemetry" : null)) as K | null;
  const active = tabs.some((t) => t.key === requested)
    ? requested!
    : tabs[0].key;
  const setTab = (tab: K) => {
    const next = new URLSearchParams(params);
    // The first tab drops `?tab=` unless a lap selection would then reopen
    // Lap telemetry.
    if (tab === tabs[0].key && !hasLapRefs)
      next.delete(SESSION_TAB_QUERY_PARAM);
    else next.set(SESSION_TAB_QUERY_PARAM, tab);
    setParams(next, { replace: true });
    window.scrollTo({ top: 0 });
  };
  return [active, setTab];
}

function titleLabel(
  summary: SessionSummary | undefined,
  kind: SessionKind,
  type: string,
): string {
  if (kind === "long-run") return "Long run";
  if (kind === "time-trial") return "Time trial";
  if (kind === "race") return summary ? sessionRowLabel(summary) : "Race";
  return formatSessionType(type);
}

function DaySwitcher({
  current,
  sessions,
}: {
  current: string;
  sessions: SessionSummary[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (sessions.length < 2) return null;
  const online = sessions.filter((s) => s.isOnline);
  const offline = sessions.filter((s) => !s.isOnline);
  const row = (session: SessionSummary) => {
    const result = sessionResult(session);
    const best = sessionBestLapMs(session);
    return (
      <Link
        key={session.slug}
        to={sessionSummaryPath(session)}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-baseline justify-between gap-6 rounded-lg px-2.5 py-1.5 text-sm",
          session.slug === current
            ? "bg-active/10 text-tone-50"
            : "text-tone-200 hover:bg-tone-800",
        )}
      >
        <span>{sessionRowLabel(session)}</span>
        <span className="text-xs text-tone-400 tabular-nums">
          {result ? (
            <b className="font-semibold text-tone-100">{result.main}</b>
          ) : best ? (
            <span className="font-mono">{msToLapTime(best)}</span>
          ) : null}{" "}
          · {sessionClock(session)}
        </span>
      </Link>
    );
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Other sessions that day"
        className="grid size-7 place-items-center rounded-lg text-tone-500 hover:bg-tone-900 hover:text-tone-100"
      >
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1.5 w-80 rounded-xl bg-tone-900 p-1.5 shadow-2xl shadow-tone-1000/40 ring-1 ring-tone-800">
          {online.length > 0 && (
            <div className="px-2.5 pt-1.5 pb-1 text-xs text-tone-500">
              Online
            </div>
          )}
          {online.map(row)}
          {offline.length > 0 && (
            <div className="px-2.5 pt-2 pb-1 text-xs text-tone-500">
              Practice
            </div>
          )}
          {offline.map(row)}
        </div>
      )}
    </div>
  );
}

/**
 * Header, navigation and tabs shared by every session page. ‹ › and J/K step
 * through the session log as the user filtered it (falling back to the whole
 * scope when this session is filtered out); the title's ▾ lists that day's
 * sessions at the track; the event strip links an online quali and race.
 */
export function SessionShell<K extends string>({
  session,
  slug,
  kind,
  tabs,
  activeTab,
  onTabChange,
  actions,
  children,
}: {
  session: TelemetrySession;
  slug: string;
  kind: SessionKind;
  tabs: readonly SessionTab<K>[];
  activeTab: K;
  onTabChange: (tab: K) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { activeFormulaKey } = useTelemetry();
  const scoped = useScopedSessions();
  const { order } = useSessionLog();
  const summary = scoped.find(
    (s) => s.slug === slug || sessionSaveSlugs(s).includes(slug),
  );
  const info = session["session-info"];
  const trackId = getTrackId(summary?.track ?? String(info["track-id"]));
  const trackName = summary?.track ?? String(info["track-id"]);
  const dayKey = summary ? sessionDayKey(summary) : "";

  const list = order.some((s) => s.slug === summary?.slug) ? order : scoped;
  const index = list.findIndex((s) => s.slug === summary?.slug);
  const newer = index > 0 ? list[index - 1] : undefined;
  const older = index >= 0 ? list[index + 1] : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest("input, textarea, select, [contenteditable]") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "k" && newer) navigate(sessionSummaryPath(newer));
      if (event.key === "j" && older) navigate(sessionSummaryPath(older));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, newer, older]);

  const daySessions = scoped.filter(
    (s) => sessionDayKey(s) === dayKey && getTrackId(s.track) === trackId,
  );
  const event = summary?.isOnline
    ? daySessions.filter((s) => s.isOnline).reverse()
    : [];

  const drivers = session["classification-data"]?.length ?? 0;
  const meta = [
    summary?.isOnline
      ? "Online"
      : kind === "time-trial"
        ? "Hot laps"
        : summary?.aiDifficulty
          ? `Practice vs AI ${summary.aiDifficulty}`
          : "Offline",
    kind !== "time-trial" && drivers > 1 ? `${drivers} drivers` : null,
    (kind === "race" || kind === "long-run") && info["total-laps"]
      ? kind === "long-run"
        ? `${summary?.playerRaceResult?.playerLaps ?? "?"} of ${info["total-laps"]} laps`
        : `${info["total-laps"]} laps`
      : null,
    summary ? sessionClock(summary) : null,
    [
      info.weather,
      info["track-temperature"] ? `track ${info["track-temperature"]}°C` : null,
    ]
      .filter(Boolean)
      .join(", ") || null,
  ].filter(Boolean);

  const navButton = (
    target: SessionSummary | undefined,
    direction: "newer" | "older",
  ) => (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && navigate(sessionSummaryPath(target))}
      title={
        target
          ? `${direction === "newer" ? "Newer" : "Older"}: ${sessionRowLabel(target)}, ${formatDayLabel(sessionDayKey(target))} ${sessionClock(target)} (${direction === "newer" ? "K" : "J"})`
          : undefined
      }
      className="grid size-8 place-items-center rounded-lg text-tone-200 ring-1 ring-tone-800 transition-colors hover:bg-tone-900 disabled:cursor-default disabled:opacity-35"
    >
      {direction === "newer" ? (
        <ChevronLeft className="size-4" />
      ) : (
        <ChevronRight className="size-4" />
      )}
    </button>
  );

  const trackLink = (className?: string) =>
    activeFormulaKey && (
      <Link
        to={trackPath(
          activeFormulaKey,
          trackId,
          kind === "time-trial"
            ? "time-trial"
            : kind === "qualifying"
              ? trackTabForSessionType(info["session-type"])
              : "overview",
        )}
        className={cn(
          "ml-auto shrink-0 text-sm whitespace-nowrap text-tone-500 hover:text-tone-100",
          className,
        )}
      >
        {getTrackDisplayName(trackName)} track page →
      </Link>
    );
  // Quali/race pills or page actions get a row of their own, with the track
  // link beside them; without them the link sits at the end of the tabs on
  // wider screens and keeps its own row on phones, where the tabs need the
  // width.
  const hasStrip = event.length > 1 || actions != null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 pb-16 sm:px-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-tone-500">
            <Link
              to={dashboardPath(activeFormulaKey)}
              className="hover:text-tone-200"
            >
              Sessions
            </Link>
            {dayKey && <> › {formatDayLabel(dayKey)}</>}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-tone-50 sm:text-[1.75rem]">
              <TrackFlag track={trackName} size="medium" />
              {getTrackDisplayName(trackName)}{" "}
              {titleLabel(summary, kind, info["session-type"])}
            </h1>
            {summary && (
              <DaySwitcher current={summary.slug} sessions={daySessions} />
            )}
          </div>
          <p className="mt-1 text-sm text-tone-500">{meta.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-5">
          {navButton(newer, "newer")}
          {navButton(older, "older")}
        </div>
      </div>

      {hasStrip ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {event.length > 1 &&
            event.map((s) => {
              const result = sessionResult(s);
              const isCurrent = s.slug === summary?.slug;
              return (
                <Link
                  key={s.slug}
                  to={sessionSummaryPath(s)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs ring-1",
                    isCurrent
                      ? "text-tone-50 ring-active/50"
                      : "text-tone-400 ring-tone-800 hover:text-tone-100",
                  )}
                >
                  {summaryKind(s) === "race" ? "Race" : "Quali"}{" "}
                  {result && (
                    <b className="font-semibold text-tone-50">{result.main}</b>
                  )}
                  {summaryKind(s) === "qualifying" && sessionBestLapMs(s) && (
                    <span className="font-mono">
                      {" "}
                      · {msToLapTime(sessionBestLapMs(s)!)}
                    </span>
                  )}
                </Link>
              );
            })}
          {actions}
          {trackLink()}
        </div>
      ) : (
        <div className="mt-3 flex sm:hidden">{trackLink()}</div>
      )}

      <div className="mt-4 flex items-start gap-4 border-b border-tone-800">
        <div
          role="tablist"
          className="flex min-w-0 flex-1 gap-5 overflow-x-auto text-sm"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={tab.key === activeTab}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "-mb-px border-b-2 pb-2.5 whitespace-nowrap transition-colors",
                tab.key === activeTab
                  ? "border-tone-50 font-medium text-tone-50"
                  : "border-transparent text-tone-400 hover:text-tone-100",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {!hasStrip && trackLink("max-sm:hidden")}
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}
