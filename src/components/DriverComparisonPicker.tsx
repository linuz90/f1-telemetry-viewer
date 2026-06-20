import type { DriverData, TelemetrySession } from "../types/telemetry";
import { cn } from "../utils/cn";
import { getTeamColor, getTeamName } from "../utils/colors";
import {
  findClosestRival,
  findFastestLapDriver,
  findRaceWinner,
} from "../utils/stats/drivers";
import {
  PillSelect,
  type PillSelectOption,
  type PillSelectSize,
  type PillSelectWidth,
} from "./ui/PillSelect";

interface DriverComparisonPickerProps {
  session: TelemetrySession;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  focusedDriverIndex: number;
  size?: PillSelectSize;
  width?: PillSelectWidth;
}

function driverOptionLabel(driver: DriverData, tags: string[]): string {
  const position = driver["final-classification"]?.position ?? "?";
  const tagSuffix = tags.length > 0 ? ` (${tags.join(", ")})` : "";
  return `P${position} ${driver["driver-name"]} — ${getTeamName(driver.team)}${tagSuffix}`;
}

export function DriverComparisonPicker({
  session,
  selectedIndex,
  onSelect,
  focusedDriverIndex,
  size = "md",
  width = "session",
}: DriverComparisonPickerProps) {
  const drivers = session["classification-data"] ?? [];
  const focused = drivers.find((d) => d.index === focusedDriverIndex);
  const focusedPos = focused?.["final-classification"]?.position ?? 0;
  const winner = findRaceWinner(session);
  const closest = findClosestRival(session, focusedPos);
  const fastest = findFastestLapDriver(session);

  // All drivers sorted by position (for the dropdown)
  const dropdownDrivers = [...drivers].sort(
    (a, b) =>
      (a["final-classification"]?.position ?? 999) -
      (b["final-classification"]?.position ?? 999),
  );
  const rivalDrivers = dropdownDrivers.filter(
    (d) => d.index !== focusedDriverIndex,
  );
  const selectedDriver = rivalDrivers.find((d) => d.index === selectedIndex);
  const compareOptions: PillSelectOption[] = [
    { value: "", label: "Compare with..." },
    ...rivalDrivers.map((d) => {
      const tags = [
        d.index === closest?.index ? "Closest" : undefined,
        d.index === fastest?.index ? "Fastest" : undefined,
        d.index === winner?.index ? "Winner" : undefined,
      ].filter((tag): tag is string => Boolean(tag));

      return {
        value: d.index,
        label: driverOptionLabel(d, tags),
      };
    }),
  ];

  if (rivalDrivers.length === 0) return null;

  return (
    <PillSelect
      value={selectedIndex ?? ""}
      onChange={(value) => {
        onSelect(value === "" ? null : Number(value));
      }}
      options={compareOptions}
      ariaLabel="Compare with driver"
      dotColor={selectedDriver ? getTeamColor(selectedDriver.team) : undefined}
      size={size}
      width={width}
      className={cn(selectedIndex === null && "text-zinc-400")}
    />
  );
}
