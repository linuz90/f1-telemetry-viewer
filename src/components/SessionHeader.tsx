import { useMemo } from "react";
import { ChevronDown, ExternalLink, Flag, Gauge, Target, Timer } from "lucide-react";
import { Link } from "react-router-dom";
import type { TelemetrySession } from "../types/telemetry";
import { getBestLapTime } from "../utils/stats";
import { formatSessionType } from "../utils/format";
import { getTeamColor, getTeamName } from "../utils/colors";
import { getFormulaComparisonKey, getFormulaLabel, shouldShowFormulaLabel } from "../utils/sessionTypes";
import { trackPath, trackTabForSessionType } from "../utils/routes";
import { TrackFlag } from "./TrackFlag";
import { TrackLayout } from "./TrackLayout";
import { HStack } from "./ui/Stack";

const EXT_LINK_TEMPLATE = import.meta.env.VITE_EXTERNAL_LINK_TEMPLATE as string | undefined;
const EXT_LINK_LABEL = import.meta.env.VITE_EXTERNAL_LINK_LABEL as string | undefined;

const SESSION_ICONS: Record<string, typeof Flag> = {
  Race: Flag,
  "Short Qualifying": Timer,
  "Short Quali": Timer,
  "Short Sprint Shootout": Timer,
  "Sprint Shootout": Timer,
  "Short Session Shootout": Timer,
  "Session Shootout": Timer,
  "One Shot Qualifying": Target,
  "One-Shot Quali": Target,
  "Time Trial": Gauge,
};

interface SessionHeaderProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
  onFocusedDriverChange: (index: number) => void;
  slug?: string;
  showDriverSelector?: boolean;
}

export function SessionHeader({
  session,
  focusedDriverIndex,
  onFocusedDriverChange,
  slug,
  showDriverSelector = true,
}: SessionHeaderProps) {
  const info = session["session-info"];
  const drivers = session["classification-data"] ?? [];
  const focusedDriver = drivers.find((d) => d.index === focusedDriverIndex);

  const sessionType = formatSessionType(info["session-type"], info.formula);
  const TypeIcon = SESSION_ICONS[info["session-type"]] ?? SESSION_ICONS[sessionType] ?? Flag;
  const formulaKey = getFormulaComparisonKey(info.formula, session["game-year"]);
  const showFormula = shouldShowFormulaLabel(info.formula, session["game-year"]);
  const trackTab = trackTabForSessionType(info["session-type"]);

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
        // For qualifying without final-classification, sort by best lap
        const bestA = getBestLapTime(a["session-history"]["lap-history-data"]);
        const bestB = getBestLapTime(b["session-history"]["lap-history-data"]);
        return bestA - bestB;
      });
  }, [drivers, focusedDriverIndex]);

  return (
    <HStack align="start" className="mb-6 gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        {/* Title row */}
        <HStack className="gap-3">
          <h2 className="text-xl font-bold">
            <Link
              to={trackPath(formulaKey, info["track-id"], trackTab)}
              className="hover:text-best transition-colors"
            >
              <TrackFlag track={info["track-id"]} className="mr-1" />{" "}
              {info["track-id"]}
            </Link>
          </h2>
          <HStack as="span" className="gap-1 text-sm text-zinc-400">
            <TypeIcon className="size-3.5" />
            {sessionType}
          </HStack>
          {showFormula && (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-zinc-400">
              {getFormulaLabel(info.formula, session["game-year"])}
            </span>
          )}
        </HStack>

        <HStack wrap className="gap-2 text-xs text-zinc-400">
          {showDriverSelector && (
            <span className="relative inline-flex items-center">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1"
                style={{
                  backgroundColor: focusedDriver
                    ? getTeamColor(focusedDriver.team)
                    : undefined,
                }}
              />
              <select
                value={focusedDriverIndex}
                onChange={(e) => onFocusedDriverChange(Number(e.target.value))}
                className="appearance-none bg-zinc-900 text-zinc-200 text-xs font-medium rounded-full pl-2 pr-6 py-1 border-0 focus:outline-none focus:ring-1 focus:ring-purple-500/40 cursor-pointer"
              >
                {selectableDrivers.map((d) => {
                  const pos = d["final-classification"]?.position;
                  const suffix = d["is-player"] ? " (You)" : "";
                  const prefix = pos ? `P${pos} ` : "";
                  return (
                    <option key={d.index} value={d.index}>
                      {prefix}
                      {d["driver-name"]} — {getTeamName(d.team)}
                      {suffix}
                    </option>
                  );
                })}
              </select>
              <ChevronDown className="absolute right-1.5 size-3 pointer-events-none text-zinc-500" />
            </span>
          )}

          {slug && EXT_LINK_TEMPLATE && EXT_LINK_LABEL && (
            <a
              href={EXT_LINK_TEMPLATE.replace("{slug}", slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
            >
              <ExternalLink className="size-3" />
              {EXT_LINK_LABEL}
            </a>
          )}
        </HStack>
      </div>
      <TrackLayout
        track={info["track-id"]}
        className="hidden sm:block size-20 shrink-0 text-zinc-600 [&>svg]:size-full"
      />
    </HStack>
  );
}
