import { useMemo, useState } from "react";
import {
  bestLapCandidates,
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
import { Badge } from "../ui/Badge";
import { Modal } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";
import { driverLabel, recordingLabel, recordingTeamColor } from "./labels";
import type { SlotName } from "./types";

const KIND_LABELS: Record<TrackSessionKind, string> = {
  qualifying: "Qualifying",
  race: "Race",
  "time-trial": "Time Trial",
};

interface PickerRow {
  key: string;
  candidate?: LapCandidate;
  lapTimeMs: number;
  driver: string;
  team?: string;
  context: string;
  badges: string[];
  reason?: string;
}

function RowButton({
  row,
  slot,
  fastest,
  onPick,
}: {
  row: PickerRow;
  slot?: SlotName;
  fastest: boolean;
  onPick: (candidate: LapCandidate) => void;
}) {
  const disabled = !row.candidate;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => row.candidate && onPick(row.candidate)}
      className={cn(
        "grid w-full grid-cols-[1.5rem_5rem_1fr_auto] items-center gap-x-3 rounded-lg px-2.5 py-1.5 text-left transition-colors",
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-zinc-800/60",
        slot && "bg-zinc-800/50",
      )}
    >
      <span className="font-mono text-2xs font-semibold text-zinc-400">
        {slot ?? ""}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          fastest ? "text-best font-semibold" : "text-zinc-200",
        )}
      >
        {msToLapTime(row.lapTimeMs)}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="h-3.5 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: recordingTeamColor(row.team) }}
        />
        <span className="truncate text-sm text-zinc-200">{row.driver}</span>
        <span className="hidden truncate text-xs text-zinc-500 sm:inline">
          {row.context}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {row.reason ? (
          <span className="text-2xs text-zinc-500">{row.reason}</span>
        ) : (
          row.badges.map((badge) => (
            <Badge key={badge} tone="zinc" size="xs" shape="square">
              {badge}
            </Badge>
          ))
        )}
      </span>
    </button>
  );
}

function candidateBadges(candidate: LapCandidate): string[] {
  return [
    ...(candidate.compound ? [candidate.compound] : []),
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
  /** One-click comparison laps, resolved against lap A. */
  presets: readonly LapPreset[];
  onPick: (candidate: LapCandidate) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"session" | "track">(
    sessionManifest ? "session" : "track",
  );
  const [who, setWho] = useState<"mine" | "everyone">("everyone");
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
  const [selectedKind, setSelectedKind] = useState<TrackSessionKind>(kind);
  const sessionDrivers = useMemo(() => {
    if (!sessionManifest || !sessionRecording) return [];
    const candidates = manifestCandidates(sessionManifest, sessionRecording);
    return sessionManifest.drivers
      .map((driver) => {
        const laps = candidates.filter(
          (c) => c.ref.driverIndex === driver.index,
        );
        const best = laps
          .filter((c) => c.eligible)
          .sort((a, b) => a.lapTimeMs - b.lapTimeMs)[0];
        return { driver, laps, best };
      })
      .filter((entry) => entry.driver.laps.some((lap) => lap.lapTimeMs))
      .sort(
        (a, b) =>
          (a.best?.lapTimeMs ?? Infinity) - (b.best?.lapTimeMs ?? Infinity),
      );
  }, [sessionManifest, sessionRecording]);
  const [sessionDriver, setSessionDriver] = useState<number | undefined>(
    () =>
      sessionDrivers.find(
        (entry) => entry.driver.index === sessionManifest?.playerIndex,
      )?.driver.index ?? sessionDrivers[0]?.driver.index,
  );

  const trackRows = useMemo(() => {
    const recordings = trackRecordings.filter(
      (recording) =>
        trackTabForSessionType(recording.sessionType) === selectedKind,
    );
    const rows: PickerRow[] = [];
    for (const candidate of bestLapCandidates(recordings)) {
      if (who === "mine" && !candidate.isPlayer) continue;
      rows.push({
        key: lapRefKey(candidate.ref),
        candidate,
        lapTimeMs: candidate.lapTimeMs,
        driver: driverLabel(candidate.driverName, candidate.isPlayer),
        team: candidate.team,
        // Dedupe hides superseded restarts; their recordings stay pickable.
        context: `${recordingLabel(candidate.recording)}${
          candidate.recording.sessionSlug &&
          !listedSessionSlugs.has(candidate.recording.sessionSlug)
            ? " · restarted run"
            : ""
        }`,
        badges: candidateBadges(candidate),
      });
    }
    const partial: PickerRow[] = [];
    for (const recording of recordings) {
      for (const driver of recording.drivers) {
        const isPlayer = driver.index === recording.playerIndex;
        if (!driver.fasterIncomplete || (who === "mine" && !isPlayer)) continue;
        partial.push({
          key: lapRefKey({
            recordingSlug: recording.slug,
            driverIndex: driver.index,
            lapNumber: driver.fasterIncomplete.lapNumber,
          }),
          lapTimeMs: driver.fasterIncomplete.lapTimeMs,
          driver: driverLabel(driver.name, isPlayer),
          team: driver.team,
          context: recordingLabel(recording),
          badges: [],
          reason: driver.fasterIncomplete.reason,
        });
      }
    }
    rows.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
    partial.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
    return { rows, partial };
  }, [listedSessionSlugs, selectedKind, trackRecordings, who]);

  const activeDriver = sessionDrivers.find(
    (entry) => entry.driver.index === sessionDriver,
  );
  const sessionFastest = sessionDrivers[0]?.best?.lapTimeMs;

  return (
    <Modal onClose={onClose} className="max-h-[85vh] max-w-2xl overflow-hidden">
      <div className="flex min-h-0 flex-col gap-3 p-5">
        <div className="pr-8">
          <h3 className="text-lg font-semibold text-zinc-100">
            Choose lap {slotName}
          </h3>
          <p className="text-xs text-zinc-500">
            Only laps recorded start to finish can be compared.
          </p>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const current =
                !!preset.candidate &&
                slotsByKey.get(lapRefKey(preset.candidate.ref)) === slotName;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!preset.candidate}
                  title={preset.reason}
                  onClick={() => preset.candidate && onPick(preset.candidate)}
                  aria-pressed={current}
                  className={cn(
                    "flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    current
                      ? "bg-zinc-700/70 ring-1 ring-inset ring-white/[0.08]"
                      : "bg-zinc-800/60 enabled:hover:bg-zinc-700/50",
                  )}
                >
                  <span className="font-medium text-zinc-200">
                    {preset.label}
                  </span>
                  {preset.candidate && (
                    <span className="text-zinc-500">
                      {driverLabel(
                        preset.candidate.driverName,
                        preset.candidate.isPlayer,
                      )}{" "}
                      <span className="font-mono tabular-nums">
                        {msToLapTime(preset.candidate.lapTimeMs)}
                      </span>
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
              ]}
            />
          )}
        </div>

        {view === "session" && sessionManifest ? (
          <div className="grid min-h-0 gap-3 overflow-hidden sm:grid-cols-[13rem_1fr]">
            <ul className="max-h-[22rem] space-y-0.5 overflow-y-auto sm:max-h-[50vh]">
              {sessionDrivers.map(({ driver, best }) => (
                <li key={driver.index}>
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
                    <span className="flex-1 truncate">
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
            <div className="max-h-[22rem] space-y-0.5 overflow-y-auto sm:max-h-[50vh]">
              {activeDriver?.driver.laps
                .filter((lap) => lap.lapTimeMs)
                .map((lap) => {
                  const candidate = activeDriver.laps.find(
                    (c) => c.ref.lapNumber === lap.lapNumber,
                  );
                  const key = lapRefKey({
                    recordingSlug: sessionManifest.slug,
                    driverIndex: activeDriver.driver.index,
                    lapNumber: lap.lapNumber,
                  });
                  return (
                    <RowButton
                      key={key}
                      slot={slotsByKey.get(key)}
                      fastest={
                        !!candidate?.eligible &&
                        lap.lapTimeMs === sessionFastest
                      }
                      onPick={onPick}
                      row={{
                        key,
                        candidate,
                        lapTimeMs: lap.lapTimeMs!,
                        driver: `Lap ${lap.lapNumber}`,
                        team: activeDriver.driver.team,
                        context: "",
                        badges: candidate
                          ? candidateBadges(candidate)
                          : lap.compound
                            ? [lap.compound]
                            : [],
                        reason: candidate
                          ? undefined
                          : (lap.incompleteReason ?? "partial trace"),
                      }}
                    />
                  );
                })}
            </div>
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-0.5 overflow-y-auto">
            {trackRows.rows.length === 0 && (
              <p className="px-2.5 py-4 text-sm text-zinc-500">
                No complete laps recorded here yet.
              </p>
            )}
            {trackRows.rows.map((row, index) => (
              <RowButton
                key={row.key}
                row={row}
                slot={slotsByKey.get(row.key)}
                fastest={index === 0}
                onPick={onPick}
              />
            ))}
            {trackRows.partial.length > 0 && (
              <>
                <p className="px-2.5 pb-1 pt-3 font-mono text-2xs uppercase tracking-wider text-zinc-600">
                  Recorded, but not the whole lap
                </p>
                {trackRows.partial.map((row) => (
                  <RowButton
                    key={row.key}
                    row={row}
                    fastest={false}
                    onPick={onPick}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
