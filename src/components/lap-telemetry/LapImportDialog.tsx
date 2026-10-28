import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  familyOf,
  importedLapRefs,
  LAP_TELEMETRY_ANCHOR,
  lapRefKey,
  LAPS_QUERY_PARAM,
} from "../../analysis/lapTelemetrySelection";
import { useLapImports } from "../../context/LapImportsContext";
import {
  applyImportOwner,
  type LapImport,
  type LapImportOwner,
} from "../../context/lapImports";
import { useTelemetry } from "../../context/TelemetryContext";
import { useLapRecordingList } from "../../hooks/useLapRecordings";
import { cn } from "../../utils/cn";
import { msToLapTime, titleCaseName } from "../../utils/format";
import { summarizeLapRecording } from "../../utils/lapRecording/reader";
import { trackPath } from "../../utils/routes";
import { getTrackDisplayName } from "../../utils/tracks";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { SegmentedControl } from "../ui/SegmentedControl";
import { recordingLabel, recordingTeamColor } from "./labels";

/** Asks whose laps a freshly imported file holds, then opens the comparison. */
export function LapImportDialog() {
  const { prompt } = useLapImports();
  return prompt ? <OwnerForm key={prompt.slug} entry={prompt} /> : null;
}

function OwnerForm({ entry }: { entry: LapImport }) {
  const { setOwner, closePrompt } = useLapImports();
  const close = () => closePrompt(entry.slug);
  const titleId = useId();
  const { formulaOptions } = useTelemetry();
  const { recordings } = useLapRecordingList();
  const navigate = useNavigate();

  const drivers = useMemo(() => {
    const summary = summarizeLapRecording(entry.raw);
    return entry.raw.drivers
      .map((driver) => ({
        index: driver.index,
        name: titleCaseName(driver.name),
        team: driver.team,
        best: summary.drivers.find((d) => d.index === driver.index)?.best,
        complete: driver.laps.filter((lap) => lap.complete && lap.lapTimeMs)
          .length,
      }))
      .sort(
        (a, b) =>
          (a.best?.lapTimeMs ?? Infinity) - (b.best?.lapTimeMs ?? Infinity) ||
          b.complete - a.complete,
      );
  }, [entry.raw]);
  const comparable = drivers.filter((driver) => driver.complete > 0);

  const [who, setWho] = useState<"friend" | "me">(
    entry.owner?.name === null ? "me" : "friend",
  );
  const [name, setName] = useState(entry.owner?.name ?? "");
  // One car with complete laps is almost always the owner's.
  const [driverIndex, setDriverIndex] = useState<number | undefined>(
    entry.owner?.driverIndex ??
      (comparable.length === 1 ? comparable[0].index : undefined),
  );
  const [showAll, setShowAll] = useState(false);
  const picked = drivers.find((driver) => driver.index === driverIndex);
  const listed = showAll
    ? drivers
    : drivers.filter(
        (driver) => driver.complete > 0 || driver.index === driverIndex,
      );

  const family = familyOf(summarizeLapRecording(entry.raw));
  const scopeLoaded = formulaOptions.some(
    (option) => option.key === family.formulaKey,
  );

  const confirm = () => {
    if (driverIndex === undefined) return;
    const owner: LapImportOwner = {
      driverIndex,
      name: who === "me" ? null : name.trim(),
    };
    setOwner(entry.slug, owner);
    close();
    if (!scopeLoaded) return;
    const refs = importedLapRefs(
      summarizeLapRecording(applyImportOwner(entry.raw, entry.slug, owner)),
      driverIndex,
      recordings,
    );
    // Written by hand, like the section does, so `~` and `,` stay readable.
    const laps = refs.length
      ? `&${LAPS_QUERY_PARAM}=${refs.map(lapRefKey).join(",")}`
      : "";
    navigate(
      `${trackPath(family.formulaKey, family.track, family.kind)}${laps}#${LAP_TELEMETRY_ANCHOR}`,
    );
  };

  return (
    <Modal
      onClose={close}
      labelledBy={titleId}
      className="max-h-[85vh] max-w-lg"
    >
      <form
        className="flex min-h-0 flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <div className="pr-8">
          <h3 id={titleId} className="text-lg font-semibold text-tone-100">
            Whose laps are these?
          </h3>
          <p className="text-xs text-tone-500">
            {getTrackDisplayName(entry.raw.track)} · {recordingLabel(entry.raw)}{" "}
            · {entry.fileName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Whose file"
            size="sm"
            value={who}
            onChange={setWho}
            options={[
              { value: "friend", label: "A friend's" },
              { value: "me", label: "Mine" },
            ]}
          />
          {who === "friend" && (
            <Input
              size="sm"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Their name"
              aria-label="Friend's name"
              maxLength={24}
              containerClassName="flex-1 min-w-32"
            />
          )}
        </div>

        <div className="min-h-0 space-y-1">
          <p className="text-xs text-tone-500">
            Lap files don't say who was driving. Which car was{" "}
            {who === "me" ? "yours" : "theirs"}?
          </p>
          <div
            role="radiogroup"
            aria-label="Car"
            className="max-h-[40vh] space-y-0.5 overflow-y-auto"
          >
            {listed.map((driver) => (
              <button
                key={driver.index}
                type="button"
                role="radio"
                aria-checked={driver.index === driverIndex}
                onClick={() => setDriverIndex(driver.index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                  driver.index === driverIndex
                    ? "bg-tone-800 text-tone-100 ring-1 ring-inset ring-tone-0/[0.08]"
                    : "text-tone-400 hover:bg-tone-800/50",
                )}
              >
                <span
                  className="h-3.5 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: recordingTeamColor(driver.team) }}
                />
                <span className="flex-1 truncate">
                  {driver.name}{" "}
                  <span className="ml-1 text-xs text-tone-600">
                    {driver.team}
                  </span>
                </span>
                <span className="font-mono text-xs tabular-nums text-tone-500">
                  {driver.best
                    ? msToLapTime(driver.best.lapTimeMs)
                    : driver.complete > 0
                      ? `${driver.complete} complete`
                      : "no complete lap"}
                </span>
              </button>
            ))}
          </div>
          {listed.length < drivers.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="px-2.5 text-xs text-tone-500 underline-offset-2 hover:text-tone-300 hover:underline"
            >
              {comparable.length === 0
                ? "No car has a complete lap; show all"
                : `Show the ${drivers.length - listed.length} cars without a complete lap`}
            </button>
          )}
        </div>

        {picked && !picked.best && (
          <p className="text-xs text-tone-500">
            {picked.complete > 0
              ? "Its complete laps are all invalid or pit laps"
              : "The file has no complete lap of this car"}
            , so there is nothing of {who === "me" ? "yours" : "theirs"} to
            compare yet.
          </p>
        )}
        {!scopeLoaded && (
          <p className="text-xs text-tone-500">
            No {entry.raw.formula ?? "matching"} sessions are loaded, so these
            laps will show once some are.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Not now
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={driverIndex === undefined}
          >
            {scopeLoaded ? "Compare laps" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
