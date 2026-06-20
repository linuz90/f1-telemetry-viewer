import { useMemo } from "react";
import type { TelemetrySession } from "../types/telemetry";
import { getBestLapTime } from "../utils/stats/laps";
import { getTeamColor, getTeamName } from "../utils/colors";
import {
  PillSelect,
  type PillSelectOption,
  type PillSelectSize,
  type PillSelectWidth,
} from "./ui/PillSelect";

interface SessionDriverSelectProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
  onFocusedDriverChange: (index: number) => void;
  size?: PillSelectSize;
  width?: PillSelectWidth;
}

export function SessionDriverSelect({
  session,
  focusedDriverIndex,
  onFocusedDriverChange,
  size = "md",
  width = "session",
}: SessionDriverSelectProps) {
  const drivers = session["classification-data"] ?? [];
  const focusedDriver = drivers.find((d) => d.index === focusedDriverIndex);

  // Keep no-lap classified drivers selectable so terminal-damage DNFs can still
  // focus the player instead of falling back to the first timed finisher.
  const selectableDrivers = useMemo(() => {
    return drivers
      .filter((d) => {
        const laps = d["session-history"]["lap-history-data"];
        return (
          laps.some((l) => l["lap-time-in-ms"] > 0) ||
          d.index === focusedDriverIndex ||
          d["is-player"] ||
          d["final-classification"] != null
        );
      })
      .sort((a, b) => {
        const posA = a["final-classification"]?.position ?? 999;
        const posB = b["final-classification"]?.position ?? 999;
        if (posA !== posB) return posA - posB;
        // For qualifying without final-classification, sort by best lap.
        const bestA = getBestLapTime(a["session-history"]["lap-history-data"]);
        const bestB = getBestLapTime(b["session-history"]["lap-history-data"]);
        return bestA - bestB;
      });
  }, [drivers, focusedDriverIndex]);

  const driverOptions = useMemo<PillSelectOption[]>(
    () =>
      selectableDrivers.map((d) => {
        const pos = d["final-classification"]?.position;
        const suffix = d["is-player"] ? " (You)" : "";
        const prefix = pos ? `P${pos} ` : "";
        return {
          value: d.index,
          label: `${prefix}${d["driver-name"]} — ${getTeamName(d.team)}${suffix}`,
        };
      }),
    [selectableDrivers],
  );

  return (
    <PillSelect
      value={focusedDriverIndex}
      onChange={(value) => onFocusedDriverChange(Number(value))}
      options={driverOptions}
      ariaLabel="Focused driver"
      dotColor={focusedDriver ? getTeamColor(focusedDriver.team) : undefined}
      size={size}
      width={width}
    />
  );
}
