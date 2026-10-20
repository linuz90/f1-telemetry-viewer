import { useEffect, useMemo, useRef, useState } from "react";
import {
  bestLapCandidates,
  lapIdentity,
  lapRefKey,
  manifestCandidates,
  type LapCandidate,
  type LapPreset,
} from "../../analysis/lapTelemetrySelection";
import type { TrackSessionKind } from "../../analysis/trackAnalysis";
import { cn } from "../../utils/cn";
import { msToLapTime } from "../../utils/format";
import type {
  LapRecordingManifest,
  LapRecordingSummary,
} from "../../utils/lapRecording/types";
import { trackTabForSessionType } from "../../utils/routes";
import { TRACK_KIND_META } from "../sessionTypeMeta";
import { Badge } from "../ui/Badge";
import { CompoundSwatchLabel } from "../ui/CompoundSwatchLabel";
import { Eyebrow } from "../ui/Eyebrow";
import { Modal } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";
import { driverLabel, recordingLabel, recordingTeamColor } from "./labels";
import type { SlotName } from "./types";

const KIND_LABELS: Record<TrackSessionKind, string> = {
  qualifying: "Qualifying",
  race: "Race",
  "time-trial": "Time Trial",
};

type Who = "everyone" | "mine" | "friends";

/** F1 timing colours: purple for the fastest lap of all, green for a
 *  driver's own best. */
type LapHighlight = "fastest" | "personal";

type LapOrder = "lap" | "time";

const PRESET_COLUMNS = [
  "",
  "sm:grid-cols-1",
  "sm:grid-cols-2",
  "sm:grid-cols-3",
];

interface PickerRow {
  key: string;
  candidate: LapCandidate;
  lapTimeMs: number;
  driver: string;
  team?: string;
  context: string;
  badges: string[];
}

function RowButton({
  row,
  slot,
  highlight,
  showTeam = true,
  onPick,
}: {
  row: PickerRow;
  slot?: SlotName;
  highlight?: LapHighlight;
  /** Off in one driver's lap list, where every row shares the colour. */
  showTeam?: boolean;
  onPick: (candidate: LapCandidate) => void;
}) {
  return (
    <button
      type="button"
      data-slot={slot}
      onClick={() => onPick(row.candidate)}
      className={cn(
        "grid w-full grid-cols-[1.5rem_5rem_1fr_auto] items-center gap-x-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-800/60",
        slot && "bg-zinc-800/50",
      )}
    >
      <span className="font-mono text-2xs font-semibold text-zinc-400">
        {slot ?? ""}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          highlight === "fastest"
            ? "text-best font-semibold"
            : highlight === "personal"
              ? "text-ahead font-semibold"
              : "text-zinc-200",
        )}
      >
        {msToLapTime(row.lapTimeMs)}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {showTeam && (
          <span
            className="h-3.5 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: recordingTeamColor(row.team) }}
          />
        )}
        <span className="truncate text-sm text-zinc-200">{row.driver}</span>
        {row.candidate.isFriend && (
          <Badge tone="sky" size="xs" shape="square" className="shrink-0">
            Friend
          </Badge>
        )}
        <span className="hidden truncate text-xs text-zinc-500 sm:inline">
          {row.context}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {row.candidate.compound && (
          <CompoundSwatchLabel
            compound={row.candidate.compound}
            size="xs"
            className="mr-0.5"
          />
        )}
        {row.badges.map((badge) => (
          <Badge key={badge} tone="zinc" size="xs" shape="square">
            {badge}
          </Badge>
        ))}
      </span>
    </button>
  );
}

function candidateBadges(candidate: LapCandidate): string[] {
  return [
    ...(candidate.valid ? [] : ["Invalid"]),
    ...(candidate.pitLap ? ["Pit"] : []),
    ...(candidate.standingStart ? ["Start"] : []),
  ];
}

export function LapPicker({
  slotName,
  slotsByKey,
  trackName,
  kind,
  sessionRecording,
  sessionManifest,
  trackRecordings,
  listedSessionSlugs,
  presets,
  current,
  onPick,
  onClose,
}: {
  slotName: SlotName;
  slotsByKey: ReadonlyMap<string, SlotName>;
  trackName: string;
  kind: TrackSessionKind;
  sessionRecording?: LapRecordingSummary;
  sessionManifest?: LapRecordingManifest;
  /** Same circuit and formula scope, any session kind. */
  trackRecordings: readonly LapRecordingSummary[];
  listedSessionSlugs: ReadonlySet<string>;
  /** One-click picks, resolved against the other lap in the comparison. */
  presets: readonly LapPreset[];
  /** The lap in the slot being changed; the picker opens where it lives. */
  current?: LapCandidate;
  onPick: (candidate: LapCandidate) => void;
  onClose: () => void;
}) {
  const currentInSession =
    !!current &&
    !!sessionManifest &&
    current.ref.recordingSlug === sessionManifest.slug;
  const [view, setView] = useState<"session" | "track">(
    sessionManifest && (!current || currentInSession) ? "session" : "track",
  );
  const [who, setWho] = useState<Who>(current?.isPlayer ? "mine" : "everyone");
  const hasFriends = trackRecordings.some(
    (recording) => recording.friendIndex !== undefined,
  );
  const kinds = useMemo(
    () =>
      (Object.keys(KIND_LABELS) as TrackSessionKind[]).filter((option) =>
        trackRecordings.some(
          (recording) =>
            trackTabForSessionType(recording.sessionType) === option,
        ),
      ),
    [trackRecordings],
  );
  // A track tab can hold a lap of another kind, e.g. your race lap against a
  // friend's qualifying lap, so the slot's own lap decides.
  const [selectedKind, setSelectedKind] = useState<TrackSessionKind>(
    current ? trackTabForSessionType(current.recording.sessionType) : kind,
  );
  const sessionDrivers = useMemo(() => {
    if (!sessionManifest || !sessionRecording) return [];
    const candidates = manifestCandidates(sessionManifest, sessionRecording);
    return (
      sessionManifest.drivers
        .map((driver) => {
          const laps = candidates.filter(
            (c) => c.ref.driverIndex === driver.index,
          );
          const best = laps
            .filter((c) => c.eligible)
            .sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0];
          return { driver, laps, best };
        })
        // Partial laps cannot be compared, so drivers without a whole lap go.
        .filter((entry) => entry.laps.length > 0)
        // You lead the list whatever your pace; everyone else by best lap.
        .sort(
          (a, b) =>
            Number(b.driver.index === sessionManifest.playerIndex) -
              Number(a.driver.index === sessionManifest.playerIndex) ||
            (a.best?.lapTimeMs ?? Infinity) - (b.best?.lapTimeMs ?? Infinity),
        )
    );
  }, [sessionManifest, sessionRecording]);
  const [sessionDriver, setSessionDriver] = useState<number | undefined>(
    () =>
      (currentInSession ? current?.ref.driverIndex : undefined) ??
      sessionDrivers.find(
        (entry) => entry.driver.index === sessionManifest?.playerIndex,
      )?.driver.index ??
      sessionDrivers[0]?.driver.index,
  );

  const trackRows = useMemo((): PickerRow[] => {
    const recordings = trackRecordings.filter(
      (recording) =>
        trackTabForSessionType(recording.sessionType) === selectedKind,
    );
    // The same session saved twice (a Manual save, then Just_in_case) holds
    // identical laps: list each once, keeping the copy in a slot, else the
    // one whose session is listed.
    const byLap = new Map<
      string,
      PickerRow & { rank: number; restarted: boolean }
    >();
    // A kept re-save reads as the listed session it copies, not a restart.
    const listedContext = new Map<string, string>();
    for (const candidate of bestLapCandidates(recordings)) {
      if (who === "mine" && !candidate.isPlayer) continue;
      if (who === "friends" && !candidate.isFriend) continue;
      const key = lapRefKey(candidate.ref);
      // Dedupe hides superseded restarts; their recordings stay pickable.
      const restarted =
        !!candidate.recording.sessionSlug &&
        !listedSessionSlugs.has(candidate.recording.sessionSlug);
      const row = {
        key,
        candidate,
        lapTimeMs: candidate.lapTimeMs,
        driver: driverLabel(candidate.driverName, candidate.isPlayer),
        team: candidate.team,
        context: `${recordingLabel(candidate.recording, candidate.ref.driverIndex)}${restarted ? " · restarted run" : ""}`,
        badges: candidateBadges(candidate),
        rank: slotsByKey.has(key) ? 0 : restarted ? 2 : 1,
        restarted,
      };
      const lapId = lapIdentity(candidate);
      if (!restarted) listedContext.set(lapId, row.context);
      const kept = byLap.get(lapId);
      if (!kept || row.rank < kept.rank) byLap.set(lapId, row);
    }
    return [...byLap.entries()]
      .map(([lapId, row]) => ({
        ...row,
        // Only a kept restart borrows the listed copy's label; a listed row
        // keeps its own, or picking it would open a different copy's session.
        context: row.restarted
          ? (listedContext.get(lapId) ?? row.context)
          : row.context,
      }))
      .sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  }, [listedSessionSlugs, selectedKind, slotsByKey, trackRecordings, who]);

  const [lapOrder, setLapOrder] = useState<LapOrder>("lap");
  const activeDriver = sessionDrivers.find(
    (entry) => entry.driver.index === sessionDriver,
  );
  const activeLaps =
    lapOrder === "time"
      ? [...(activeDriver?.laps ?? [])].sort(
          (a, b) => a.lapTimeMs - b.lapTimeMs,
        )
      : (activeDriver?.laps ?? []);
  const sessionFastest = Math.min(
    ...sessionDrivers.map((entry) => entry.best?.lapTimeMs ?? Infinity),
  );

  // Long lists open scrolled to the lap being replaced.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current
      ?.querySelector(`[data-slot="${slotName}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [slotName]);

  return (
    <Modal onClose={onClose} className="max-h-[85vh] max-w-2xl overflow-hidden">
      <div ref={bodyRef} className="flex min-h-0 flex-col gap-3 p-5">
        <div className="pr-8">
          <h3 className="text-lg font-semibold text-zinc-100">
            Choose lap {slotName}
          </h3>
          <p className="text-xs text-zinc-500">
            Only laps recorded start to finish are listed.
          </p>
        </div>
        {/* A row of nothing but reasons says nothing the list does not. */}
        {presets.some((preset) => preset.candidate) && (
          <div className={cn("grid gap-2", PRESET_COLUMNS[presets.length])}>
            {presets.map((preset) => {
              const lap = preset.candidate;
              const slot = lap && slotsByKey.get(lapRefKey(lap.ref));
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!lap}
                  onClick={() => lap && onPick(lap)}
                  aria-pressed={slot === slotName}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors disabled:cursor-default",
                    slot === slotName
                      ? "bg-zinc-800 ring-white/[0.1]"
                      : "bg-zinc-800/40 ring-white/[0.04] enabled:hover:bg-zinc-800/80",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <Eyebrow>{preset.label}</Eyebrow>
                    {slot && (
                      <span className="font-mono text-2xs font-semibold text-zinc-400">
                        {slot}
                      </span>
                    )}
                  </span>
                  {lap ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3.5 w-1 shrink-0 rounded-full"
                        style={{
                          backgroundColor: recordingTeamColor(lap.team),
                        }}
                      />
                      <span className="truncate text-sm text-zinc-200">
                        {driverLabel(lap.driverName, lap.isPlayer)}
                      </span>
                      <span
                        className={cn(
                          "ml-auto font-mono text-sm tabular-nums",
                          preset.id === "my-best"
                            ? "text-zinc-100"
                            : "text-best",
                        )}
                      >
                        {msToLapTime(lap.lapTimeMs)}
                      </span>
                    </span>
                  ) : (
                    <span className="block text-sm text-zinc-500 first-letter:uppercase">
                      {preset.reason}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {sessionManifest && (
            <SegmentedControl
              ariaLabel="Lap source"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "session", label: "This session" },
                { value: "track", label: `All runs at ${trackName}` },
              ]}
            />
          )}
          {view === "track" && kinds.length > 1 && (
            <SegmentedControl
              ariaLabel="Session type"
              size="sm"
              value={selectedKind}
              onChange={setSelectedKind}
              options={kinds.map((option) => ({
                value: option,
                label: KIND_LABELS[option],
                icon: TRACK_KIND_META[option].icon,
              }))}
            />
          )}
          {view === "track" && (
            <SegmentedControl
              ariaLabel="Drivers"
              size="sm"
              value={who}
              onChange={setWho}
              options={[
                { value: "everyone", label: "Everyone" },
                { value: "mine", label: "Mine" },
                ...(hasFriends
                  ? [{ value: "friends" as const, label: "Friends" }]
                  : []),
              ]}
            />
          )}
        </div>

        {view === "session" && sessionManifest ? (
          <div className="grid min-h-0 gap-3 overflow-hidden sm:grid-cols-[13rem_1fr]">
            <ul className="max-h-[22rem] space-y-0.5 overflow-y-auto sm:max-h-[50vh]">
              {sessionDrivers.map(({ driver, best }) => (
                <li
                  key={driver.index}
                  className={cn(
                    driver.index === sessionManifest.playerIndex &&
                      "mb-1 border-b border-white/[0.06] pb-1",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSessionDriver(driver.index)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                      driver.index === sessionDriver
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800/50",
                    )}
                  >
                    <span
                      className="h-3.5 w-1 shrink-0 rounded-full"
                      style={{
                        backgroundColor: recordingTeamColor(driver.team),
                      }}
                    />
                    <span
                      className={cn(
                        "flex-1 truncate",
                        driver.index === sessionManifest.playerIndex &&
                          "font-medium text-zinc-100",
                      )}
                    >
                      {driverLabel(
                        driver.name,
                        driver.index === sessionManifest.playerIndex,
                      )}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        best && best.lapTimeMs === sessionFastest
                          ? "text-best"
                          : "text-zinc-500",
                      )}
                    >
                      {best ? msToLapTime(best.lapTimeMs) : "–"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-h-0 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 pl-2.5">
                <span className="truncate text-xs text-zinc-500">
                  {activeDriver &&
                    `${driverLabel(
                      activeDriver.driver.name,
                      activeDriver.driver.index === sessionManifest.playerIndex,
                    )} · ${activeDriver.laps.length} ${activeDriver.laps.length === 1 ? "lap" : "laps"}`}
                </span>
                <SegmentedControl
                  ariaLabel="Lap order"
                  size="sm"
                  value={lapOrder}
                  onChange={setLapOrder}
                  options={[
                    { value: "lap", label: "Lap" },
                    { value: "time", label: "Time" },
                  ]}
                />
              </div>
              <div className="max-h-[22rem] space-y-0.5 overflow-y-auto sm:max-h-[50vh]">
                {activeLaps.map((candidate) => {
                  const key = lapRefKey(candidate.ref);
                  return (
                    <RowButton
                      key={key}
                      slot={slotsByKey.get(key)}
                      highlight={
                        candidate.eligible &&
                        candidate.lapTimeMs === sessionFastest
                          ? "fastest"
                          : candidate === activeDriver?.best
                            ? "personal"
                            : undefined
                      }
                      showTeam={false}
                      onPick={onPick}
                      row={{
                        key,
                        candidate,
                        lapTimeMs: candidate.lapTimeMs,
                        driver: `Lap ${candidate.ref.lapNumber}`,
                        team: candidate.team,
                        context: "",
                        badges: candidateBadges(candidate),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-0.5 overflow-y-auto">
            {trackRows.length === 0 && (
              <p className="px-2.5 py-4 text-sm text-zinc-500">
                {who === "mine"
                  ? "No complete lap of yours here yet."
                  : who === "friends"
                    ? "No complete lap from a friend here yet."
                    : "No complete laps recorded here yet."}
              </p>
            )}
            {trackRows.map((row, index) => (
              <RowButton
                key={row.key}
                row={row}
                slot={slotsByKey.get(row.key)}
                highlight={index === 0 ? "fastest" : undefined}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
