import { useEffect, useMemo, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import { useSession } from "../hooks/useSession";
import { useSessionLog, useTrackIndex } from "../hooks/useSessionLog";
import {
  areSessionFiltersDefault,
  DEFAULT_FILTERS,
  sessionFiltersFromParams,
  sessionFiltersToParams,
  type SessionListFilters,
  type SessionTypeFilter,
} from "../hooks/useSessionFilters";
import { summaryKind } from "../analysis/sessionKind";
import { sessionBestLapMs, sessionDayKey } from "../analysis/sessionLog";
import { buildOnlineForm } from "../analysis/onlineForm";
import { buildRaceStory, buildRaceHeadline } from "../analysis/raceStory";
import { buildRacePaceRank } from "../analysis/worthALook";
import type { SessionSummary } from "../types/telemetry";
import { findPlayer } from "../utils/stats/drivers";
import { ordinal } from "../utils/stats/core";
import { getTrackDisplayName, getTrackId } from "../utils/tracks";
import { msToLapTime } from "../utils/format";
import { formPath, sessionSummaryPath } from "../utils/routes";
import { cn } from "../utils/cn";
import { LapChart } from "../components/charts/LapChart";
import { FormChart } from "../components/charts/FormChart";
import { SessionLog } from "../components/sessions/SessionLog";
import { formatDayLabel } from "../components/sessions/sessionFormat";
import { TrackOutline } from "../components/TrackOutline";
import { PillSelect } from "../components/ui/PillSelect";

const TYPE_OPTIONS: { value: SessionTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "race", label: "Races" },
  { value: "long-run", label: "Long runs" },
  { value: "quali", label: "Qualifying" },
  { value: "tt", label: "Time trial" },
];

/** A whole card opens its page; ⌘/Ctrl-click opens it in a new tab, as a
 *  link would, and clicks on a link inside the card are left to that link. */
function openCard(
  event: MouseEvent,
  href: string,
  navigate: (to: string) => void,
) {
  if ((event.target as HTMLElement).closest("a")) return;
  if (event.metaKey || event.ctrlKey) {
    window.open(href, "_blank", "noopener");
    return;
  }
  navigate(href);
}

function LatestRaceCard({
  summary,
  label,
}: {
  summary: SessionSummary;
  label: string;
}) {
  const { session } = useSession(summary.slug);
  const navigate = useNavigate();
  const model = useMemo(() => {
    if (!session) return null;
    const player = findPlayer(session);
    if (!player) return null;
    const story = buildRaceStory(session, player);
    if (!story) return null;
    const pace = buildRacePaceRank(session, player);
    return {
      story,
      pace,
      headline: buildRaceHeadline(session, player, story, pace),
    };
  }, [session]);
  const result = summary.playerRaceResult;
  const href = sessionSummaryPath(summary);
  return (
    <section
      onClick={(event) => openCard(event, href, navigate)}
      className="relative cursor-pointer overflow-hidden rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800 transition-shadow hover:ring-tone-700"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-tone-500">
            {label} · {formatDayLabel(sessionDayKey(summary))}
            {summary.isOnline ? " · Online" : ""}
          </div>
          <div className="mt-0.5 text-lg font-semibold tracking-tight text-tone-50">
            {getTrackDisplayName(summary.track)}
          </div>
        </div>
        <TrackOutline
          track={summary.track}
          glow
          className="-mt-1 h-16 w-24 shrink-0"
        />
      </div>
      <div className="mt-2 flex items-baseline gap-4">
        <span className="text-6xl font-bold tracking-tighter text-tone-50">
          {result ? `P${result.position}` : "—"}
        </span>
        <span className="text-sm leading-snug text-tone-400">
          {result?.gridPosition ? (
            <>
              from{" "}
              <b className="font-semibold text-tone-100">
                P{result.gridPosition}
              </b>
            </>
          ) : null}
          {result?.points ? ` · ${result.points} pts` : ""}
          {model && (
            <span className="mt-0.5 block text-tone-200">
              {model.headline.text}
            </span>
          )}
        </span>
      </div>
      {model && (
        <LapChart
          compact
          className="mt-3"
          laps={model.story.lastLap}
          panels={[
            {
              kind: "position",
              height: 52,
              trace: model.story.trace,
              maxPosition: Math.max(9, ...model.story.trace),
            },
          ]}
        />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-tone-800 pt-3 text-sm text-tone-400">
        {model?.pace && (
          <span>
            Race pace{" "}
            <b className="font-semibold text-tone-100">
              {ordinal(model.pace.rank)}
            </b>
          </span>
        )}
        {result?.bestLapTimeMs && (
          <span>
            Best lap{" "}
            <b className="font-mono font-semibold text-best">
              {msToLapTime(result.bestLapTimeMs)}
            </b>
          </span>
        )}
        <Link
          to={href}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-tone-500 hover:text-tone-100"
        >
          Open debrief →
        </Link>
      </div>
    </section>
  );
}

function FormCard() {
  const { activeFormulaKey } = useTelemetry();
  const { scoped } = useSessionLog();
  const navigate = useNavigate();
  const form = useMemo(
    () => buildOnlineForm(scoped, activeFormulaKey),
    [scoped, activeFormulaKey],
  );
  if (!form || !activeFormulaKey) return null;
  const { recent, stats } = form;
  const podiums = stats.wins + stats.p2 + stats.p3;
  const delta =
    recent.averageGrid != null && recent.averageFinish != null
      ? recent.averageFinish - recent.averageGrid
      : null;
  return (
    <section
      onClick={(event) => openCard(event, formPath(activeFormulaKey), navigate)}
      className="cursor-pointer rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800 transition-shadow hover:ring-tone-700"
    >
      <div className="text-xs text-tone-500">
        Your {stats.mode === "session-history" ? "" : "online "}form ·{" "}
        {recent.count === 1 ? "last race" : `last ${recent.count} races`}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div>
          <div className="text-4xl font-bold tracking-tight text-tone-50">
            {recent.averageGrid != null
              ? `P${recent.averageGrid.toFixed(1)}`
              : "—"}
          </div>
          <div className="text-xs text-tone-500">avg grid</div>
        </div>
        <span className="text-xl text-tone-600">→</span>
        <div>
          <div
            className={cn(
              "text-4xl font-bold tracking-tight",
              delta == null
                ? "text-tone-50"
                : delta > 0.5
                  ? "text-behind"
                  : delta < -0.5
                    ? "text-ahead"
                    : "text-tone-50",
            )}
          >
            {recent.averageFinish != null
              ? `P${recent.averageFinish.toFixed(1)}`
              : "—"}
          </div>
          <div className="text-xs text-tone-500">avg finish</div>
        </div>
      </div>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <FormChart
          races={form.races.slice(-recent.count)}
          height={150}
          labelEvery={99}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-tone-800 pt-3 text-sm text-tone-400">
        {stats.averageFinish != null && (
          <span>
            Season{" "}
            <b className="font-semibold text-tone-100">
              P{stats.averageFinish.toFixed(1)}
            </b>{" "}
            avg finish
          </span>
        )}
        <span>
          <b className="font-semibold text-tone-100">{podiums}</b> podium
          {podiums === 1 ? "" : "s"}
        </span>
        <Link
          to={formPath(activeFormulaKey)}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-tone-500 hover:text-tone-100"
        >
          Full form →
        </Link>
      </div>
    </section>
  );
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: SessionListFilters;
  onChange: (next: SessionListFilters) => void;
}) {
  const index = useTrackIndex();
  return (
    <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-2 bg-canvas/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div
        role="tablist"
        aria-label="Session type"
        className="flex overflow-x-auto rounded-xl bg-tone-900 p-1 ring-1 ring-tone-800"
      >
        {TYPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filters.type === option.value}
            onClick={() => onChange({ ...filters, type: option.value })}
            className={cn(
              "rounded-lg px-3 py-1 text-sm whitespace-nowrap transition-colors",
              filters.type === option.value
                ? "bg-tone-800 font-medium text-tone-50"
                : "text-tone-400 hover:text-tone-100",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <PillSelect
        value={filters.mode}
        onChange={(mode) =>
          onChange({ ...filters, mode: mode as SessionListFilters["mode"] })
        }
        options={[
          { value: "all", label: "Online and offline" },
          { value: "online", label: "Online only" },
          { value: "ai", label: "Vs AI only" },
        ]}
        ariaLabel="Online or offline"
        size="md"
      />
      <PillSelect
        value={filters.track ?? ""}
        onChange={(track) =>
          onChange({ ...filters, track: String(track) || null })
        }
        options={[
          { value: "", label: "All tracks" },
          ...index.entries.map((entry) => ({
            value: entry.trackId,
            label: getTrackDisplayName(entry.track),
          })),
        ]}
        ariaLabel="Track"
        size="md"
      />
      {!areSessionFiltersDefault(filters) && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-sm text-tone-400 hover:text-tone-100"
        >
          Reset
        </button>
      )}
    </div>
  );
}

/**
 * Sessions is the home page: your latest race and your form on top, then the
 * whole log. Filters live in the URL as well as the shared store, so a filtered
 * log is linkable and the session pages' ‹ › walk the same list.
 */
export function SessionsPage() {
  const { activeFormula, mode } = useTelemetry();
  const { scoped, filtered, days, filters, setFilters } = useSessionLog();
  const trackIndex = useTrackIndex();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL wins on arrival (a shared or menu link); afterwards the controls
  // write both.
  useEffect(() => {
    const fromUrl = sessionFiltersFromParams(searchParams);
    if (fromUrl && JSON.stringify(fromUrl) !== JSON.stringify(filters)) {
      setFilters(fromUrl);
    } else if (!fromUrl && !areSessionFiltersDefault(filters)) {
      setSearchParams(sessionFiltersToParams(filters), { replace: true });
    }
    // Only on URL changes: the store follows the URL, not the reverse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const changeFilters = (next: SessionListFilters) => {
    setFilters(next);
    setSearchParams(sessionFiltersToParams(next), { replace: true });
  };

  const pbByTrack = useMemo(
    () => new Map(trackIndex.entries.map((e) => [e.trackId, e.qualiPbMs])),
    [trackIndex],
  );
  const isPb = (session: SessionSummary) =>
    summaryKind(session) === "qualifying" &&
    sessionBestLapMs(session) != null &&
    sessionBestLapMs(session) === pbByTrack.get(getTrackId(session.track));

  const latestRace = scoped.find(
    (s) => summaryKind(s) === "race" && s.playerRaceResult && !s.isSynthetic,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-tone-50">
          {mode === "demo" ? "Demo" : (activeFormula?.label ?? "Sessions")}
        </h1>
        <p className="mt-1 text-sm text-tone-500">
          {scoped.length} session{scoped.length === 1 ? "" : "s"} across{" "}
          {trackIndex.entries.length} track
          {trackIndex.entries.length === 1 ? "" : "s"}
          {scoped[0] &&
            ` · last driven ${formatDayLabel(sessionDayKey(scoped[0]))}`}
        </p>
      </div>

      {(latestRace || scoped.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {latestRace && (
            <LatestRaceCard
              summary={latestRace}
              // Demo stubs have no detail to draw, so the demo card shows the
              // one race that has it, which is not the newest.
              label={mode === "demo" ? "Demo race" : "Latest race"}
            />
          )}
          <FormCard />
        </div>
      )}

      <div className="mt-8 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-tone-50">
          Sessions
        </h2>
        <span className="text-sm text-tone-500">
          {areSessionFiltersDefault(filters)
            ? "newest first"
            : `${filtered.length} of ${scoped.length}`}
        </span>
      </div>
      <FilterBar filters={filters} onChange={changeFilters} />
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-tone-900 px-5 py-10 text-center ring-1 ring-tone-800">
          <p className="text-sm text-tone-300">
            {scoped.length === 0
              ? "No sessions in this scope yet."
              : "No sessions match these filters."}
          </p>
          {scoped.length > 0 && (
            <button
              type="button"
              onClick={() => changeFilters(DEFAULT_FILTERS)}
              className="mt-3 text-sm text-active hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <SessionLog
          days={days}
          isPb={isPb}
          expandOffline={filters.type !== "all"}
        />
      )}
    </div>
  );
}
