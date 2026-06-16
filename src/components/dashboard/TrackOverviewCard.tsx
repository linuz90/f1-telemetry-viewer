import { Link } from "react-router-dom";
import type { SessionSummary } from "../../types/telemetry";
import { cn } from "../../utils/cn";
import { formatShortDate } from "../../utils/format";
import { cardClass } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { TrackLayout } from "../TrackLayout";
import {
  isProblemStatus,
  positionLabel,
  positionTone,
  resultStatusLabel,
  signedNumber,
  type TrackLapRecord,
  type TrackRaceRecord,
  type TrackRecords,
  trackFormulaPath,
} from "./helpers";

function modeLabel(session: SessionSummary): string {
  if (session.isOnline) return "Online";
  if (session.aiDifficulty != null && session.aiDifficulty > 0) {
    return `AI ${session.aiDifficulty}`;
  }
  return "Offline";
}

function RecordMetric({
  label,
  value,
  detail,
  tone = "text-zinc-100",
}: {
  label: string;
  value?: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-2xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-[15px] font-semibold tabular-nums",
          value ? tone : "text-zinc-700",
        )}
      >
        {value ?? "—"}
      </div>
      {detail && (
        <div className="mt-0.5 truncate text-2xs text-zinc-500">
          {detail}
        </div>
      )}
    </div>
  );
}

function lapRecordMetric(record: TrackLapRecord | undefined) {
  if (!record) return {};
  return {
    value: record.time,
    detail: formatShortDate(record.session.date),
  };
}

function raceRecordMetric(record: TrackRaceRecord | undefined) {
  if (!record) return {};

  const statusProblem = isProblemStatus(record.status);
  const details = [
    statusProblem ? resultStatusLabel(record.status) : null,
    modeLabel(record.session),
    record.gridGain != null ? `${signedNumber(record.gridGain)} grid` : null,
  ].filter(Boolean);

  return {
    value: positionLabel(record.position),
    detail: details.join(" · "),
    tone: statusProblem ? "text-red-300" : positionTone(record.position),
  };
}

export function TrackOverviewCard({
  track,
  sessions,
  activeFormulaKey,
  records,
}: {
  track: string;
  sessions: SessionSummary[];
  activeFormulaKey: string | undefined;
  records: TrackRecords;
}) {
  const lastDriven = sessions
    .map((session) => new Date(session.date).getTime())
    .sort((a, b) => b - a)[0];
  // Synthetic-only tracks have nothing to show on the TrackPage — render the
  // card as static, dim, and non-interactive in demo mode.
  const isSyntheticOnly = sessions.every((session) => session.isSynthetic);
  const race = raceRecordMetric(records.race);
  const onlineQualifying = lapRecordMetric(records.onlineQualifying);
  const offlineQualifying = lapRecordMetric(records.offlineQualifying);
  const timeTrial = lapRecordMetric(records.timeTrial);

  const inner = (
    <>
      <TrackLayout
        track={track}
        className="pointer-events-none absolute right-5 top-3 size-12 text-zinc-500/30 transition-colors group-hover:text-purple-400/50 sm:size-14 [&>svg]:size-full"
      />

      <div className="relative pr-20">
        <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
          <TrackFlag track={track} />
          <span className="truncate">{track}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span>
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
          {lastDriven && (
            <span>
              Last {formatShortDate(new Date(lastDriven).toISOString())}
            </span>
          )}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-white/[0.06] pt-4">
        <RecordMetric
          label="Race"
          value={race.value}
          detail={race.detail}
          tone={race.tone}
        />
        <RecordMetric
          label="Online Q"
          value={onlineQualifying.value}
          detail={onlineQualifying.detail}
          tone="text-purple-300"
        />
        <RecordMetric
          label="TT"
          value={timeTrial.value}
          detail={timeTrial.detail}
          tone="text-cyan-300"
        />
        <RecordMetric
          label="Offline Q"
          value={offlineQualifying.value}
          detail={offlineQualifying.detail}
          tone="text-purple-300"
        />
      </div>
    </>
  );

  if (isSyntheticOnly) {
    return (
      <div
        title="Demo data — upload your telemetry to explore this track"
        className={cn(cardClass, "relative min-h-40 overflow-hidden opacity-70")}
      >
        {inner}
      </div>
    );
  }

  if (!activeFormulaKey) {
    return (
      <div className={cn(cardClass, "relative min-h-40 overflow-hidden opacity-70")}>
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={trackFormulaPath(track, activeFormulaKey)}
      className={cn(
        cardClass,
        "group relative min-h-40 overflow-hidden transition-colors hover:bg-zinc-800/50",
      )}
    >
      {inner}
    </Link>
  );
}
