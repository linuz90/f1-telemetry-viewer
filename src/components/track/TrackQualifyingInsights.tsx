import {
  Crown,
  Globe,
  History,
  Monitor,
  Swords,
  Target,
  Timer,
  TimerReset,
  Trophy,
} from "lucide-react";
import { msToLapTime, msToSectorTime } from "../../utils/format";
import type { TrackQualifyingInsights as TrackQualifyingInsightsModel } from "../../utils/qualifyingInsights";
import { InsightTile } from "../ui/InsightTile";
import { SectionHeader } from "../ui/SectionHeader";

/**
 * Qualifying-tab "Key Insights" — same family as `TrackKeyInsights` on the Race
 * tab. Tiles render on a per-evidence basis so a track with only offline AI
 * qualis still gets the headline pace numbers, while online-only signals
 * (fastest pole here) appear once there's at least one online quali to pull
 * from.
 *
 * Convention notes (kept consistent with the rest of the app):
 *   - Purple is "fastest/PB" framing (broadcast convention, see memory).
 *   - Rose is reserved for "another driver beat you" — adversarial framing.
 *   - Tile bodies tint ONLY the number, prose stays neutral.
 */
export function TrackQualifyingInsights({
  insights,
}: {
  insights: TrackQualifyingInsightsModel;
}) {
  const {
    qualiCount,
    onlineCount,
    offlineCount,
    overall,
    online,
    offline,
    theoreticalBestMs,
    gapToTheoreticalMs,
    fastestOnlinePole,
    sinceLastQuali,
  } = insights;

  // Subtitle mirrors the Race section's "N races · N full-distance" format.
  // Only spell out the online split when there's actually a split worth
  // spelling out — otherwise the count alone reads cleanly.
  const subtitleParts: string[] = [];
  subtitleParts.push(`${qualiCount} quali${qualiCount === 1 ? "" : "s"}`);
  if (onlineCount > 0 && offlineCount > 0) {
    subtitleParts.push(`${onlineCount} online · ${offlineCount} offline`);
  } else if (onlineCount > 0) {
    subtitleParts.push("online");
  }
  const subtitle = subtitleParts.join(" · ");

  // When both pools exist we show them as separate tiles so the user can read
  // each ceiling independently. Otherwise we fall back to a single "best lap"
  // tile — splitting a single bucket into two would just leave one tile empty.
  const showSplitBests = online != null && offline != null;

  return (
    <div>
      <SectionHeader title="Key Insights" hint={subtitle} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {showSplitBests ? (
          <>
            <BestQualiTile
              title="Best Online Quali"
              icon={Globe}
              bucket={online}
            />
            <BestQualiTile
              title="Best Offline Quali"
              icon={Monitor}
              bucket={offline}
            />
          </>
        ) : (
          overall.bestLapMs > 0 && (
            <BestQualiTile
              title="Best Quali Lap"
              icon={Timer}
              bucket={overall}
            />
          )
        )}

        {theoreticalBestMs > 0 && (
          <InsightTile
            title="Theoretical Best"
            icon={Target}
            accent="emerald"
          >
            <div className="font-mono text-xl text-ahead">
              {msToLapTime(theoreticalBestMs)}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              sum of best S1 + S2 + S3 here
            </div>
          </InsightTile>
        )}

        {gapToTheoreticalMs > 0 && (
          <InsightTile
            title="Gap to Theoretical"
            icon={TimerReset}
            accent="amber"
          >
            <div className="font-mono text-xl text-warning">
              +{(gapToTheoreticalMs / 1000).toFixed(3)}s
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              best lap vs. theoretical
            </div>
          </InsightTile>
        )}

        {fastestOnlinePole && (
          <FastestOnlinePoleTile benchmark={fastestOnlinePole} />
        )}

        {sinceLastQuali && sinceLastQuali.bestLapDeltaMs !== 0 && (
          <VsLastQualiTile bestLapDeltaMs={sinceLastQuali.bestLapDeltaMs} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function BestQualiTile({
  title,
  icon,
  bucket,
}: {
  title: string;
  icon: typeof Timer;
  bucket: { bestLapMs: number; sessionCount: number; polesByPlayer: number };
}) {
  // Sub-line: pole share is meaningful for online sessions but harmless for
  // offline AI qualis (the player almost always sits on pole vs the field),
  // so we only render it when the player took at least one pole AND the
  // denominator gives the number context.
  const noteParts: string[] = [];
  noteParts.push(
    `${bucket.sessionCount} session${bucket.sessionCount === 1 ? "" : "s"}`,
  );
  if (bucket.polesByPlayer > 0) {
    noteParts.push(
      `pole in ${bucket.polesByPlayer}/${bucket.sessionCount}`,
    );
  }

  return (
    <InsightTile title={title} icon={icon} accent="purple">
      <div className="font-mono text-xl font-semibold text-purple-300">
        {bucket.bestLapMs > 0 ? msToLapTime(bucket.bestLapMs) : "–"}
      </div>
      <div className="mt-1.5 text-xs text-zinc-400">
        {noteParts.join(" · ")}
      </div>
    </InsightTile>
  );
}

function FastestOnlinePoleTile({
  benchmark,
}: {
  benchmark: {
    poleLapMs: number;
    deltaVsPlayerMs: number;
    onlineSessionCount: number;
    beatenSessionCount: number;
    playerSweptPoles: boolean;
  };
}) {
  // Three states drive the framing:
  //   1. Player swept every online pole here  → flex tile (purple/Trophy).
  //   2. A rival's pole beat the player's best → adversarial framing (rose/Swords).
  //   3. Player matched or no comparable lap   → neutral data tile (Crown).
  const playerLeads =
    benchmark.playerSweptPoles && benchmark.deltaVsPlayerMs >= 0;
  const rivalAhead = benchmark.deltaVsPlayerMs < 0;

  const accent: "purple" | "rose" | undefined = playerLeads
    ? "purple"
    : rivalAhead
      ? "rose"
      : undefined;
  const Icon = playerLeads ? Trophy : rivalAhead ? Swords : Crown;
  const title = playerLeads
    ? "You Own Pole Here"
    : "Fastest Online Pole Here";

  const polesByOthers = benchmark.beatenSessionCount;
  const denom = benchmark.onlineSessionCount;

  // Detail line — avoid restating the delta (the hero already shows it). Focus
  // on the share count so the user knows the *frequency* of being out-qualified,
  // not just the magnitude.
  const sessionsLabel = `${denom} online session${denom === 1 ? "" : "s"}`;
  let detail: string;
  if (playerLeads) {
    detail = `every pole here · ${sessionsLabel}`;
  } else if (polesByOthers > 0) {
    detail = `out-qualified in ${polesByOthers}/${denom} ${denom === 1 ? "session" : "sessions"}`;
  } else {
    detail = sessionsLabel;
  }

  return (
    <InsightTile title={title} icon={Icon} accent={accent}>
      <div className="font-mono text-lg text-zinc-100">
        {playerLeads ? (
          <span className="text-purple-300">{msToLapTime(benchmark.poleLapMs)}</span>
        ) : rivalAhead ? (
          <>
            <span className="text-behind">−{msToSectorTime(Math.abs(benchmark.deltaVsPlayerMs))}</span>
            <span className="ml-2 text-sm text-zinc-300">
              vs. {msToLapTime(benchmark.poleLapMs)} pole
            </span>
          </>
        ) : (
          <>Matched <span className="text-sm text-zinc-300">at {msToLapTime(benchmark.poleLapMs)}</span></>
        )}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{detail}</div>
    </InsightTile>
  );
}

function VsLastQualiTile({
  bestLapDeltaMs,
}: {
  bestLapDeltaMs: number;
}) {
  // Mirror the Race tab's vs-last-race tile: tint only the number itself, keep
  // the surrounding prose neutral so the eye lands on the delta.
  const faster = bestLapDeltaMs < 0;
  const heroVerb = faster ? "Faster by" : "Slower by";
  const heroValueTone = faster ? "text-ahead" : "text-behind";

  return (
    <InsightTile title="vs. Last Quali Here" icon={History}>
      <div className="font-mono text-lg text-zinc-100">
        {heroVerb}{" "}
        <span className={heroValueTone}>
          {msToSectorTime(Math.abs(bestLapDeltaMs))}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        best lap vs. previous quali here
      </div>
    </InsightTile>
  );
}
