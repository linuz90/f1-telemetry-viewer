import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { SessionLogDay, SessionLogGroup } from "../../analysis/sessionLog";
import { sessionBestLapMs } from "../../analysis/sessionLog";
import { sessionRowLabel } from "../../analysis/sessionKind";
import type { SessionSummary } from "../../types/telemetry";
import { getCompoundColor } from "../../utils/colors";
import { getTrackDisplayName } from "../../utils/tracks";
import { msToLapTime } from "../../utils/format";
import { sessionSummaryPath } from "../../utils/routes";
import { cn } from "../../utils/cn";
import { sessionSaveSlugs } from "../../utils/deduplicateSessions";
import { TrackFlag } from "../TrackFlag";
import { RecordedLapsIcon } from "../lap-telemetry/RecordedLapsIcon";
import {
  formatDayLabel,
  offlineGroupSummary,
  sessionClock,
  sessionCompounds,
  sessionLapCount,
  sessionResult,
} from "./sessionFormat";

const DAYS_PER_PAGE = 14;
/** Days shown per history entry, so Back returns to a log as long as it was. */
const visibleDaysByEntry = new Map<string, number>();

const ROW_GRID =
  "grid grid-cols-[3.25rem_1fr_auto_1rem] items-center gap-x-3 gap-y-0.5 md:grid-cols-[6rem_9rem_10rem_6.5rem_1fr_1rem]";

function CompoundDots({ compounds }: { compounds: string[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {compounds.map((compound, i) => (
        <span
          key={i}
          title={compound}
          className="grid size-4 place-items-center rounded-full text-[9px] font-bold"
          style={{
            backgroundColor: getCompoundColor(compound),
            color:
              compound === "Soft" || compound === "Wet" ? "#fff" : "#18181b",
          }}
        >
          {compound.charAt(0)}
        </span>
      ))}
    </span>
  );
}

function SessionLogRow({
  session,
  isPb,
}: {
  session: SessionSummary;
  isPb: boolean;
}) {
  const result = sessionResult(session);
  const best = sessionBestLapMs(session);
  const compounds = sessionCompounds(session);
  const laps = sessionLapCount(session);
  return (
    <Link
      to={sessionSummaryPath(session)}
      className={cn(
        ROW_GRID,
        "border-t border-tone-800/70 px-4 py-2.5 text-sm first:border-t-0 hover:bg-tone-800/50",
      )}
    >
      <span className="text-xs text-tone-500 tabular-nums">
        {sessionClock(session)}
      </span>
      <span className="text-tone-100">{sessionRowLabel(session)}</span>
      <span className="col-start-2 row-start-2 md:col-start-auto md:row-start-auto">
        {result ? (
          <>
            <b
              className={cn(
                "font-semibold text-tone-50",
                result.tone === "best" && "text-best",
              )}
            >
              {result.main}
            </b>{" "}
            {result.detail && (
              <span
                className={cn(
                  "text-xs",
                  result.tone === "gain"
                    ? "text-ahead"
                    : result.tone === "loss"
                      ? "text-behind"
                      : "text-tone-500",
                )}
              >
                {result.detail}
              </span>
            )}
          </>
        ) : isPb ? (
          <span className="rounded px-1 text-[11px] text-best ring-1 ring-best/40">
            PB
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "text-right font-mono text-sm tabular-nums md:text-left",
          isPb ? "text-best" : "text-tone-200",
        )}
      >
        {best ? msToLapTime(best) : ""}
      </span>
      <span className="col-start-3 row-start-2 flex items-center justify-end gap-1.5 text-xs text-tone-500 md:col-start-auto md:row-start-auto md:justify-start">
        {laps > 0 && `${laps} lap${laps === 1 ? "" : "s"}`}
        {compounds.length > 0 && <CompoundDots compounds={compounds} />}
        <RecordedLapsIcon sessionSlugs={sessionSaveSlugs(session)} />
      </span>
      <ChevronRight
        aria-hidden
        className="col-start-4 row-span-2 row-start-1 size-3.5 text-tone-600 md:col-start-auto md:row-span-1 md:row-start-auto"
      />
    </Link>
  );
}

function OnlineGroup({
  group,
  isPb,
}: {
  group: SessionLogGroup;
  isPb: (s: SessionSummary) => boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-tone-900 ring-1 ring-active/25">
      <div className="px-4 pt-2.5 pb-1 text-xs font-medium text-active">
        Online{group.driverCount ? ` · ${group.driverCount} drivers` : ""}
      </div>
      {group.sessions.map((session) => (
        <SessionLogRow
          key={session.slug}
          session={session}
          isPb={isPb(session)}
        />
      ))}
    </div>
  );
}

function OfflineGroup({
  group,
  isPb,
  defaultOpen,
}: {
  group: SessionLogGroup;
  isPb: (s: SessionSummary) => boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const newest = group.sessions[0];
  const oldest = group.sessions[group.sessions.length - 1];
  const span =
    newest === oldest
      ? sessionClock(newest)
      : `${sessionClock(oldest)}–${sessionClock(newest)}`;
  const hasPb = group.sessions.some(isPb);
  return (
    <div className="overflow-hidden rounded-xl bg-tone-900 ring-1 ring-tone-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full grid-cols-[1fr_1rem] items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-tone-800/50 md:grid-cols-[6rem_9rem_1fr_1rem]"
      >
        <span className="text-xs whitespace-nowrap text-tone-500 tabular-nums max-md:hidden">
          {span}
        </span>
        <span className="text-tone-400 max-md:hidden">
          {group.offlineLabel === "Time trial"
            ? "Time trial"
            : `Practice${group.offlineLabel && group.offlineLabel !== "Offline" ? ` vs ${group.offlineLabel}` : ""}`}
        </span>
        <span className="text-tone-400">
          <span className="md:hidden">{span} · </span>
          {offlineGroupSummary(group).map((part, i) => (
            <span key={part.label}>
              {i > 0 && " · "}
              {part.label}
              {part.bestMs && (
                <>
                  , best{" "}
                  <b
                    className={cn(
                      "font-mono font-medium",
                      hasPb && part.label.includes("quali")
                        ? "text-best"
                        : "text-tone-100",
                    )}
                  >
                    {msToLapTime(part.bestMs)}
                  </b>
                </>
              )}
            </span>
          ))}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 text-tone-600 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open &&
        group.sessions.map((session) => (
          <SessionLogRow
            key={session.slug}
            session={session}
            isPb={isPb(session)}
          />
        ))}
    </div>
  );
}

/**
 * The session log: days newest first, each day's online event as one block and
 * the offline runs folded into a practice group. Renders a couple of weeks at
 * a time and keeps growing as you scroll. `expandOffline` opens the practice
 * groups, for a log already filtered to one kind of session.
 */
export function SessionLog({
  days,
  isPb,
  expandOffline = false,
}: {
  days: SessionLogDay[];
  isPb: (session: SessionSummary) => boolean;
  expandOffline?: boolean;
}) {
  const location = useLocation();
  const [visible, setVisible] = useState(
    () => visibleDaysByEntry.get(location.key) ?? DAYS_PER_PAGE,
  );
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    visibleDaysByEntry.set(location.key, visible);
  }, [location.key, visible]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible((v) => v + DAYS_PER_PAGE);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [days.length, visible]);

  const shown = days.slice(0, visible);
  return (
    <div className="space-y-6">
      <div className={cn(ROW_GRID, "px-4 text-xs text-tone-500 max-md:hidden")}>
        <span>Time</span>
        <span>Session</span>
        <span>Result</span>
        <span>Best lap</span>
        <span>Details</span>
        <span />
      </div>
      {shown.map((day) => {
        const tracks = [...new Set(day.groups.map((g) => g.trackId))];
        return (
          <section key={day.key}>
            <h3 className="mb-2 flex items-baseline gap-2 border-b border-tone-800 px-0.5 pb-2 text-sm">
              <b className="font-semibold text-tone-50">
                {formatDayLabel(day.key)}
              </b>
              {tracks.map((trackId) => {
                const group = day.groups.find((g) => g.trackId === trackId)!;
                return (
                  <span
                    key={trackId}
                    className="inline-flex items-center gap-1.5 text-tone-200"
                  >
                    <TrackFlag track={group.track} />
                    {getTrackDisplayName(group.track)}
                  </span>
                );
              })}
            </h3>
            <div className="space-y-2">
              {day.groups.map((group) =>
                group.online ? (
                  <OnlineGroup key={group.key} group={group} isPb={isPb} />
                ) : (
                  <OfflineGroup
                    key={`${group.key}:${expandOffline}`}
                    group={group}
                    isPb={isPb}
                    defaultOpen={expandOffline}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}
      {visible < days.length ? (
        <div ref={sentinel} className="py-6 text-center text-xs text-tone-500">
          Loading older days…
        </div>
      ) : (
        days.length > 0 && (
          <p className="py-4 text-center text-xs text-tone-600">
            That's every session in this scope.
          </p>
        )
      )}
    </div>
  );
}
