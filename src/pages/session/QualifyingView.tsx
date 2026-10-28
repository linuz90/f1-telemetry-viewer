import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Flag, Repeat, Sparkles, Trophy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { TelemetrySession } from "../../types/telemetry";
import { useTelemetry } from "../../context/TelemetryContext";
import { useScopedSessions } from "../../hooks/useSessionLog";
import { useTrackHistory } from "../../hooks/useTrackHistory";
import { useLapTraceLinks } from "../../hooks/useLapRecordings";
import {
  buildQualiSummary,
  buildQualiWorthALook,
  qualiHeadline,
  type WorthTarget,
} from "../../analysis/worthALook";
import {
  driverBestLapTimeMs,
  findFocusedDriver,
} from "../../utils/stats/drivers";
import { isCompleteValidLap } from "../../utils/stats/laps";
import { msToLapTime, sectorTimeMs } from "../../utils/format";
import { getTrackDisplayName, getTrackId } from "../../utils/tracks";
import { trackPath } from "../../utils/routes";
import { cn } from "../../utils/cn";
import { TrackOutline } from "../../components/TrackOutline";
import {
  SessionShell,
  useSessionTab,
} from "../../components/session/SessionShell";
import {
  Panel,
  SetupSheet,
  StatDoors,
  WorthList,
  type StatDoor,
} from "../../components/session/SessionParts";
import { QualifyingTable } from "../../components/QualifyingTable";
import { SectorComparison } from "../../components/SectorComparison";
import { SessionDriverSelect } from "../../components/SessionDriverSelect";
import { LapTelemetrySection } from "../../components/lap-telemetry/LapTelemetrySection";
import { DuplicateNotice } from "../../components/DuplicateNotice";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "laps", label: "Laps" },
  { key: "results", label: "Results" },
  { key: "lap-telemetry", label: "Lap telemetry" },
  { key: "car", label: "Car" },
] as const;

/** Gap rows around you: the front of the grid and the cars either side. */
const GAP_ROWS = 7;

export function QualifyingView({
  session,
  slug,
}: {
  session: TelemetrySession;
  slug: string;
}) {
  const [tab, setTab] = useSessionTab(TABS);
  const navigate = useNavigate();
  const { activeFormulaKey } = useTelemetry();
  const scoped = useScopedSessions();
  const summaryMeta = scoped.find((s) => s.slug === slug);
  const drivers = session["classification-data"] ?? [];
  const [focusedIndex, setFocusedIndex] = useState(
    () => findFocusedDriver(session)?.index ?? 0,
  );
  useEffect(
    () => setFocusedIndex(findFocusedDriver(session)?.index ?? 0),
    [session],
  );
  const focused = drivers.find((d) => d.index === focusedIndex);
  const [expandedWorth, setExpandedWorth] = useState(false);
  const info = session["session-info"];
  const trackName = summaryMeta?.track ?? String(info["track-id"]);
  const { pbs } = useTrackHistory(
    trackName,
    slug,
    info.formula,
    session["game-year"],
  );
  const lapTraceHref = useLapTraceLinks(slug, focused?.index);

  const summary = useMemo(
    () => (focused ? buildQualiSummary(session, focused) : null),
    [session, focused],
  );
  const worth = useMemo(
    () =>
      summary && focused
        ? buildQualiWorthALook({
            session,
            driver: focused,
            summary,
            pbs,
            trackName: getTrackDisplayName(trackName),
          })
        : [],
    [summary, focused, session, pbs, trackName],
  );
  const openTarget = (target: WorthTarget) => {
    if (target === "track") {
      if (activeFormulaKey)
        navigate(
          trackPath(activeFormulaKey, getTrackId(trackName), "qualifying"),
        );
      return;
    }
    if (TABS.some((t) => t.key === target))
      setTab(target as (typeof TABS)[number]["key"]);
  };

  const field = useMemo(
    () =>
      drivers
        .map((d) => ({
          d,
          ms: driverBestLapTimeMs(d),
          position: d["final-classification"]?.position ?? 0,
        }))
        .filter((r) => r.ms > 0)
        .sort((a, b) => a.ms - b.ms),
    [drivers],
  );
  const pole = field[0];
  const poleLap = pole?.d["session-history"]["lap-history-data"]
    .filter(isCompleteValidLap)
    .sort((a, b) => a["lap-time-in-ms"] - b["lap-time-in-ms"])[0];
  const sessionBestSectors = ([1, 2, 3] as const).map((sector) =>
    Math.min(
      ...drivers.flatMap((d) =>
        d["session-history"]["lap-history-data"]
          .filter(isCompleteValidLap)
          .map((lap) => sectorTimeMs(lap, sector))
          .filter((ms) => ms > 0),
      ),
    ),
  );

  const shell = (children: ReactNode) => (
    <SessionShell
      session={session}
      slug={slug}
      kind="qualifying"
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      actions={
        !drivers.some((d) => d["is-player"]) ? (
          <SessionDriverSelect
            session={session}
            focusedDriverIndex={focusedIndex}
            onFocusedDriverChange={setFocusedIndex}
            size="sm"
            width="compact"
          />
        ) : undefined
      }
    >
      {children}
      <DuplicateNotice
        count={summaryMeta?.duplicateCount ?? 0}
        isAutoSave={summaryMeta?.isAutoSave}
      />
    </SessionShell>
  );

  if (!focused)
    return shell(
      <p className="text-sm text-tone-500">No driver data in this save.</p>,
    );

  const ownIndex = field.findIndex((r) => r.d.index === focused.index);
  const gapRows =
    ownIndex < GAP_ROWS - 1
      ? field.slice(0, GAP_ROWS)
      : [
          ...field.slice(0, 3),
          ...field.slice(Math.max(3, ownIndex - 1), ownIndex + 2),
        ];
  const maxGap = Math.max(
    0.4,
    ...gapRows.map((r) => (r.ms - (pole?.ms ?? r.ms)) / 1000),
  );
  const validLaps =
    focused["session-history"]["lap-history-data"].filter(isCompleteValidLap);

  const stats: StatDoor[] = summary
    ? [
        {
          label: "Ideal lap",
          icon: Sparkles,
          value: summary.idealMs ? msToLapTime(summary.idealMs) : "—",
          note:
            summary.idealMs &&
            summary.bestMs - summary.idealMs < 5 &&
            summary.bestLapNumber > 0
              ? `Lap ${summary.bestLapNumber} had all your best sectors`
              : summary.idealMs
                ? `${((summary.bestMs - summary.idealMs) / 1000).toFixed(3)} s left in your laps`
                : undefined,
          onOpen: () => setTab("laps"),
        },
        {
          label: "Runs",
          icon: Repeat,
          value: `${validLaps.length} lap${validLaps.length === 1 ? "" : "s"}`,
          note: validLaps
            .map((lap) => msToLapTime(lap["lap-time-in-ms"]))
            .join(" → "),
          onOpen: () => setTab("laps"),
        },
        {
          label: "Pole",
          icon: Flag,
          value: pole ? msToLapTime(pole.ms) : "—",
          note: pole
            ? pole.d.index === focused.index
              ? "Yours"
              : pole.d["driver-name"]
            : undefined,
          onOpen: () => setTab("results"),
        },
        {
          label: `PB at ${getTrackDisplayName(trackName)}`,
          icon: Trophy,
          value: pbs?.bestQualiLapMs
            ? msToLapTime(Math.min(pbs.bestQualiLapMs, summary.bestMs))
            : msToLapTime(summary.bestMs),
          tone: "best",
          note:
            pbs?.bestQualiLapMs && summary.bestMs > pbs.bestQualiLapMs
              ? `this lap was +${((summary.bestMs - pbs.bestQualiLapMs) / 1000).toFixed(3)}`
              : "this lap",
          to: activeFormulaKey
            ? trackPath(activeFormulaKey, getTrackId(trackName), "qualifying")
            : undefined,
        },
      ]
    : [];

  return shell(
    <>
      {tab === "overview" && summary && (
        <>
          <section className="relative overflow-hidden rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800 sm:p-6">
            <TrackOutline
              track={trackName}
              glow
              className="pointer-events-none absolute top-5 right-6 hidden h-28 w-44 sm:block"
            />
            <div className="relative flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-5">
              <span className="text-7xl leading-none font-bold tracking-tighter text-tone-50">
                {summary.position ? `P${summary.position}` : "—"}
              </span>
              <span className="text-sm leading-relaxed text-tone-400">
                <b className="font-mono text-lg font-semibold text-tone-50">
                  {msToLapTime(summary.bestMs)}
                </b>
                {summary.position && summary.position > 1 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-behind">
                      +{((summary.bestMs - summary.poleMs) / 1000).toFixed(3)}
                    </span>{" "}
                    to pole
                  </>
                )}
                <span className="mt-0.5 block text-base font-medium text-tone-50">
                  {qualiHeadline(summary)}
                </span>
              </span>
            </div>
            <div className="relative mt-5 max-w-2xl space-y-0.5">
              {gapRows.map((row) => {
                const gap = (row.ms - (pole?.ms ?? row.ms)) / 1000;
                const me = row.d.index === focused.index;
                return (
                  <div
                    key={row.d.index}
                    className={cn(
                      "grid grid-cols-[2rem_1fr_4.5rem] items-center gap-3 rounded-lg px-2 py-1 text-sm sm:grid-cols-[2rem_10rem_1fr_4.5rem]",
                      me
                        ? "bg-active/10 font-semibold text-tone-50"
                        : "text-tone-400",
                    )}
                  >
                    <span className={me ? "text-active" : "text-tone-500"}>
                      P{row.position}
                    </span>
                    <span className="truncate">
                      {me && row.d["is-player"] ? "You" : row.d["driver-name"]}
                    </span>
                    <span className="hidden h-1.5 overflow-hidden rounded-full bg-tone-800 sm:block">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          gap === 0
                            ? "bg-best"
                            : me
                              ? "bg-[var(--color-chart-you)]"
                              : "bg-tone-600",
                        )}
                        style={{
                          width: `${Math.max(2, (gap / maxGap) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs tabular-nums">
                      {gap === 0 ? "pole" : `+${gap.toFixed(3)}`}
                    </span>
                  </div>
                );
              })}
            </div>
            {summary.sectors.every((ms) => ms > 0) && (
              <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
                {([1, 2, 3] as const).map((sector, i) => {
                  const own = summary.sectors[i];
                  const ref = poleLap ? sectorTimeMs(poleLap, sector) : 0;
                  const delta = ref ? own - ref : 0;
                  const best = own > 0 && own <= sessionBestSectors[i];
                  return (
                    <div
                      key={sector}
                      className="rounded-xl bg-tone-800/40 p-3.5 ring-1 ring-tone-800"
                    >
                      <div className="text-xs text-tone-500">
                        Sector {sector}
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 font-mono text-xl font-semibold",
                          best ? "text-best" : "text-tone-50",
                        )}
                      >
                        {(own / 1000).toFixed(3)}
                      </div>
                      <div
                        className={cn(
                          "text-xs",
                          best
                            ? "text-best"
                            : delta > 0
                              ? "text-behind"
                              : delta < 0
                                ? "text-ahead"
                                : "text-tone-500",
                        )}
                      >
                        {best
                          ? "Session best"
                          : pole?.d.index === focused.index
                            ? "your pole lap"
                            : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${(Math.abs(delta) / 1000).toFixed(3)} to pole`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <StatDoors stats={stats} />
          <WorthList
            items={worth}
            onOpen={openTarget}
            expanded={expandedWorth}
            onExpand={() => setExpandedWorth(true)}
          />
        </>
      )}
      {tab === "laps" && (
        <Panel>
          <SectorComparison
            laps={focused["session-history"]["lap-history-data"]}
            stints={
              focused["session-history"]["tyre-stints-history-data"] ?? []
            }
            perLapInfo={focused["per-lap-info"] ?? []}
            lapTraceHref={lapTraceHref}
          />
        </Panel>
      )}
      {tab === "results" && (
        <Panel>
          <QualifyingTable
            session={session}
            focusedDriverIndex={focusedIndex}
          />
        </Panel>
      )}
      {tab === "lap-telemetry" && (
        <LapTelemetrySection
          scope={{
            kind: "session",
            sessionSlug: slug,
            duplicateSlugs: summaryMeta?.duplicateSlugs,
            focusedDriverIndex: focusedIndex,
          }}
        />
      )}
      {tab === "car" && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {focused["car-setup"]?.["is-valid"] && focused["is-player"] ? (
            <Panel>
              <SetupSheet
                setup={focused["car-setup"]}
                title="Setup used"
                meta="This session"
                action={
                  activeFormulaKey ? (
                    <Link
                      to={trackPath(
                        activeFormulaKey,
                        getTrackId(trackName),
                        "setups",
                      )}
                      className="text-xs text-tone-500 hover:text-tone-100"
                    >
                      {getTrackDisplayName(trackName)} setups →
                    </Link>
                  ) : undefined
                }
              />
            </Panel>
          ) : (
            <Panel title="Setup">
              <p className="text-sm text-tone-500">
                The game only exports your own setup.
              </p>
            </Panel>
          )}
        </div>
      )}
    </>,
  );
}
