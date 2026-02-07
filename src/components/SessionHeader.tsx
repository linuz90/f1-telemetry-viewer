import dayjs from "dayjs";
import { AlertTriangle, ArrowDown, ArrowUp, Calendar, Cloud, Cpu, Flag, Gauge, Globe, Target, Timer, Trophy, User } from "lucide-react";
import { Link } from "react-router-dom";
import type { TelemetrySession } from "../types/telemetry";
import { findPlayer, getBestLapTime, isRaceSession } from "../utils/stats";
import { formatSessionType, msToLapTime, getTrackFlag, toTrackSlug } from "../utils/format";

const SESSION_ICONS: Record<string, typeof Flag> = {
  Race: Flag,
  "Short Qualifying": Timer,
  "Short Quali": Timer,
  "One Shot Qualifying": Target,
  "One-Shot Quali": Target,
};

export function SessionHeader({ session }: { session: TelemetrySession }) {
  const info = session["session-info"];
  const player = findPlayer(session);
  const debug = session.debug;
  const isQuali = !isRaceSession(session);
  const isOnline = info["network-game"] === 1;

  const sessionType = formatSessionType(info["session-type"]);
  const TypeIcon = SESSION_ICONS[info["session-type"]] ?? SESSION_ICONS[sessionType] ?? Flag;

  let bestLapTimeStr: string | undefined;
  if (isQuali && player) {
    const laps = player["session-history"]["lap-history-data"];
    const bestMs = getBestLapTime(laps);
    if (bestMs > 0) bestLapTimeStr = msToLapTime(bestMs);
  }

  // Timestamp format: "2026-01-26 22:14:52 GMT Standard Time" — strip timezone name for parsing
  const rawTs = debug.timestamp.replace(/\s+[A-Z].*$/, "");
  const date = dayjs(rawTs);
  const formattedDate = date.format("ddd, D MMM YYYY");
  const formattedTime = date.format("HH:mm");

  return (
    <div className="mb-6">
      {/* Title row */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-2xl font-bold">
          <Link to={`/track/${toTrackSlug(info["track-id"])}`} className="hover:text-purple-400 transition-colors">
            {getTrackFlag(info["track-id"])} {info["track-id"]}
          </Link>
        </h2>
        <span className="flex items-center gap-1 text-sm text-zinc-400">
          <TypeIcon className="size-3.5" />
          {sessionType}
        </span>
        {bestLapTimeStr && (
          <span className="text-lg font-mono font-semibold text-purple-400">
            {bestLapTimeStr}
          </span>
        )}
      </div>

      {/* Meta pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        {player && (
          <Pill icon={User} accent>
            {player["driver-name"]} — {player.team}
          </Pill>
        )}
        {player?.["final-classification"] && (
          <Pill icon={Trophy} accent>
            P{player["final-classification"].position}
          </Pill>
        )}
        {(() => {
          if (!isRaceSession(session) || !player?.["final-classification"]) return null;
          const fc = player["final-classification"];
          const gained = fc["grid-position"] - fc.position;
          if (fc["grid-position"] <= 0 || gained === 0) return null;
          return gained > 0 ? (
            <Pill icon={ArrowUp} className="text-emerald-400 bg-emerald-400/10">
              +{gained}
            </Pill>
          ) : (
            <Pill icon={ArrowDown} className="text-red-400 bg-red-400/10">
              {gained}
            </Pill>
          );
        })()}
        {(() => {
          if (!player?.["final-classification"]) return null;
          const fc = player["final-classification"];
          if (fc["num-penalties"] <= 0) return null;
          const penaltyText = fc["penalties-time"] > 0
            ? `${fc["num-penalties"]} ${fc["num-penalties"] === 1 ? "penalty" : "penalties"} (+${fc["penalties-time"]}s)`
            : `${fc["num-penalties"]} ${fc["num-penalties"] === 1 ? "penalty" : "penalties"}`;
          return (
            <Pill icon={AlertTriangle} className="text-amber-400 bg-amber-400/10">
              {penaltyText}
            </Pill>
          );
        })()}
        <Pill icon={Calendar}>
          {formattedDate} · {formattedTime}
        </Pill>
        <Pill icon={Cloud}>
          {info.weather} · Track {info["track-temperature"]}°C · Air {info["air-temperature"]}°C
        </Pill>
        {isOnline ? (
          <Pill icon={Globe}>Online</Pill>
        ) : info["ai-difficulty"] > 0 ? (
          <Pill icon={Cpu}>AI {info["ai-difficulty"]}</Pill>
        ) : null}
        {info["total-laps"] > 0 && (
          <Pill icon={Gauge}>{info["total-laps"]} laps</Pill>
        )}
      </div>
    </div>
  );
}

function Pill({ icon: Icon, accent, className, children }: { icon: typeof Flag; accent?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${className ?? (accent ? "bg-zinc-900 text-zinc-200" : "bg-zinc-900/50 text-zinc-400")}`}>
      <Icon className="size-3" />
      {children}
    </span>
  );
}
