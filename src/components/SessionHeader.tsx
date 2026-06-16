import { useMemo } from "react";
import dayjs from "dayjs";
import { AlertTriangle, ArrowDown, ArrowUp, Calendar, ChevronDown, Cloud, Cpu, ExternalLink, Flag, Gauge, Globe, Target, Timer, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import type { TelemetrySession } from "../types/telemetry";
import { getBestLapTime, isRaceSession } from "../utils/stats";
import { formatSessionType, msToLapTime } from "../utils/format";
import { getTeamColor, getTeamName } from "../utils/colors";
import { getFormulaComparisonKey, getFormulaLabel, shouldShowFormulaLabel } from "../utils/sessionTypes";
import { cn } from "../utils/cn";
import { trackPath } from "../utils/routes";
import { TrackFlag } from "./TrackFlag";
import { TrackLayout } from "./TrackLayout";
import { HStack } from "./ui/Stack";

const EXT_LINK_TEMPLATE = import.meta.env.VITE_EXTERNAL_LINK_TEMPLATE as string | undefined;
const EXT_LINK_LABEL = import.meta.env.VITE_EXTERNAL_LINK_LABEL as string | undefined;

const SESSION_ICONS: Record<string, typeof Flag> = {
  Race: Flag,
  "Short Qualifying": Timer,
  "Short Quali": Timer,
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
  const debug = session.debug;
  const isQuali = !isRaceSession(session);
  const isOnline = info["network-game"] === 1;

  const sessionType = formatSessionType(info["session-type"], info.formula);
  const TypeIcon = SESSION_ICONS[info["session-type"]] ?? SESSION_ICONS[sessionType] ?? Flag;
  const formulaKey = getFormulaComparisonKey(info.formula, session["game-year"]);
  const showFormula = shouldShowFormulaLabel(info.formula, session["game-year"]);

  let bestLapTimeStr: string | undefined;
  if (isQuali && focusedDriver) {
    const laps = focusedDriver["session-history"]["lap-history-data"];
    const bestMs = getBestLapTime(laps);
    if (bestMs > 0) bestLapTimeStr = msToLapTime(bestMs);
  }

  // Timestamp format: "2026-01-26 22:14:52 GMT Standard Time" — strip timezone name for parsing
  const rawTs = debug.timestamp.replace(/\s+[A-Z].*$/, "");
  const date = dayjs(rawTs);
  const formattedDate = date.format("ddd, D MMM YYYY");
  const formattedTime = date.format("HH:mm");

  // Drivers with laps, sorted by position
  const selectableDrivers = useMemo(() => {
    return drivers
      .filter((d) => {
        const laps = d["session-history"]["lap-history-data"];
        return laps.some((l) => l["lap-time-in-ms"] > 0);
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
  }, [drivers]);

  return (
    <HStack align="start" className="mb-6 gap-4">
      <div className="min-w-0 flex-1">
        {/* Title row */}
        <HStack className="mb-3 gap-3">
          <h2 className="text-xl font-bold">
            <Link
              to={trackPath(formulaKey, info["track-id"])}
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
          {bestLapTimeStr && (
            <span className="text-lg font-mono font-semibold text-best">
              {bestLapTimeStr}
            </span>
          )}
        </HStack>

        {/* Meta pills */}
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

          {focusedDriver?.["final-classification"] && (
            <Pill icon={Trophy} accent>
              P{focusedDriver["final-classification"].position}
            </Pill>
          )}
          {(() => {
            if (
              !isRaceSession(session) ||
              !focusedDriver?.["final-classification"]
            ) {
              return null;
            }
            const fc = focusedDriver["final-classification"];
            const gained = fc["grid-position"] - fc.position;
            if (fc["grid-position"] <= 0 || gained === 0) return null;
            return gained > 0 ? (
              <Pill icon={ArrowUp} className="text-ahead bg-ahead/10">
                +{gained}
              </Pill>
            ) : (
              <Pill icon={ArrowDown} className="text-behind bg-behind/10">
                {gained}
              </Pill>
            );
          })()}
          {(() => {
            if (!focusedDriver?.["final-classification"]) return null;
            const fc = focusedDriver["final-classification"];
            if (fc["num-penalties"] <= 0) return null;
            const penaltyText =
              fc["penalties-time"] > 0
                ? `${fc["num-penalties"]} ${
                    fc["num-penalties"] === 1 ? "penalty" : "penalties"
                  } (+${fc["penalties-time"]}s)`
                : `${fc["num-penalties"]} ${
                    fc["num-penalties"] === 1 ? "penalty" : "penalties"
                  }`;
            return (
              <Pill icon={AlertTriangle} className="text-warning bg-warning/10">
                {penaltyText}
              </Pill>
            );
          })()}
          <Pill icon={Calendar}>
            {formattedDate} · {formattedTime}
          </Pill>
          <Pill icon={Cloud}>
            {info.weather} · Track {info["track-temperature"]}°C · Air{" "}
            {info["air-temperature"]}°C
          </Pill>
          {isOnline ? (
            <Pill icon={Globe}>Online</Pill>
          ) : info["ai-difficulty"] > 0 ? (
            <Pill icon={Cpu}>AI {info["ai-difficulty"]}</Pill>
          ) : null}
          {info["total-laps"] > 0 && (
            <Pill icon={Gauge}>{info["total-laps"]} laps</Pill>
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

function Pill({
  icon: Icon,
  accent,
  className,
  children,
}: {
  icon: typeof Flag;
  accent?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <HStack
      as="span"
      className={cn(
        "gap-1 rounded-full px-2.5 py-1",
        className ??
          (accent ? "bg-zinc-900 text-zinc-200" : "bg-zinc-900/50 text-zinc-400"),
      )}
    >
      <Icon className="size-3" />
      {children}
    </HStack>
  );
}
