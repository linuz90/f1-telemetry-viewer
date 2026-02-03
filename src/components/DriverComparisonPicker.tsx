import type { TelemetrySession, DriverData } from "../types/telemetry";
import {
  findPlayer,
  findRaceWinner,
  findClosestRival,
  findFastestLapDriver,
} from "../utils/stats";
import { getTeamColor } from "../utils/colors";

interface DriverComparisonPickerProps {
  session: TelemetrySession;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

interface Preset {
  label: string;
  driver: DriverData | undefined;
  tag: string;
}

export function DriverComparisonPicker({
  session,
  selectedIndex,
  onSelect,
}: DriverComparisonPickerProps) {
  const player = findPlayer(session);
  const playerPos = player?.["final-classification"]?.position ?? 0;
  const drivers = session["classification-data"] ?? [];

  const presets: Preset[] = [
    {
      label: "Race Winner",
      driver: findRaceWinner(session),
      tag: "P1",
    },
    {
      label: "Closest Rival",
      driver: findClosestRival(session, playerPos),
      tag: `P${playerPos > 1 ? playerPos - 1 : playerPos + 1}`,
    },
    {
      label: "Fastest Lap",
      driver: findFastestLapDriver(session),
      tag: "FL",
    },
  ];

  // Filter out presets that resolve to the player or are undefined
  const validPresets = presets.filter(
    (p) => p.driver && p.driver.index !== player?.index,
  );

  // Other drivers (non-player, not already a preset)
  const presetIndices = new Set(validPresets.map((p) => p.driver!.index));
  const otherDrivers = drivers
    .filter((d) => !d["is-player"] && !presetIndices.has(d.index))
    .sort(
      (a, b) =>
        (a["final-classification"]?.position ?? 999) -
        (b["final-classification"]?.position ?? 999),
    );

  // All non-player drivers
  const allRivals = drivers.filter((d) => !d["is-player"]);
  const singleRival = allRivals.length === 1 ? allRivals[0] : null;

  // Simplified UI when there's only one rival
  if (singleRival) {
    const isActive = selectedIndex === singleRival.index;
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
          Compare vs
        </span>

        <button
          onClick={() => onSelect(null)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            selectedIndex === null
              ? "bg-zinc-800 text-zinc-200"
              : "bg-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
          }`}
        >
          None
        </button>

        <button
          onClick={() => onSelect(isActive ? null : singleRival.index)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
            isActive
              ? "bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40"
              : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: getTeamColor(singleRival.team) }}
          />
          Rival
          <span className="text-zinc-600 text-[10px]">
            {singleRival["driver-name"]}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">
        Compare vs
      </span>

      {/* None button */}
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          selectedIndex === null
            ? "bg-zinc-800 text-zinc-200"
            : "bg-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
        }`}
      >
        None
      </button>

      {/* Preset buttons */}
      {validPresets.map((preset) => {
        const d = preset.driver!;
        const isActive = selectedIndex === d.index;
        return (
          <button
            key={d.index}
            onClick={() => onSelect(isActive ? null : d.index)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
              isActive
                ? "bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40"
                : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: getTeamColor(d.team) }}
            />
            {preset.label}
            <span className="text-zinc-600 text-[10px]">
              {d["driver-name"]}
            </span>
          </button>
        );
      })}

      {/* Full driver dropdown */}
      <select
        value={
          selectedIndex !== null && !presetIndices.has(selectedIndex)
            ? selectedIndex
            : ""
        }
        onChange={(e) => {
          const val = e.target.value;
          onSelect(val === "" ? null : Number(val));
        }}
        className="bg-zinc-900/60 text-zinc-400 text-xs rounded-md px-2 py-1.5 border border-zinc-700/50 hover:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-orange-500/40"
      >
        <option value="">Other driver...</option>
        {otherDrivers.map((d) => (
          <option key={d.index} value={d.index}>
            P{d["final-classification"]?.position ?? "?"} {d["driver-name"]} (
            {d.team})
          </option>
        ))}
      </select>
    </div>
  );
}
