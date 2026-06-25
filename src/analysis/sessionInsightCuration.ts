import type { TelemetrySession } from "../types/telemetry";
import { isRaceSession, isTimeTrialSessionType } from "../utils/sessionTypes";
import type { SessionInsight } from "./sessionInsightSummary";

/**
 * Product rules for turning raw session facts into a compact card grid. This is
 * where related rows are merged (fuel, sectors, ERS) and capped to the visible
 * insight budget; telemetry extraction itself stays in `sessionInsightSummary`.
 */

const MAX_SESSION_INSIGHTS = 9;

function compactMetricLine(prefix: string, insight: SessionInsight): string {
  return `${prefix}: ${insight.value}${insight.detail ? ` (${insight.detail})` : ""}`;
}

function compactHistoryLine(insight: SessionInsight): string {
  if (insight.label === "vs PB Sectors") {
    return `Sectors: ${insight.value}${insight.detail ? ` ${insight.detail}` : ""}`;
  }
  return compactMetricLine(insight.label.replace(/^vs\s+/i, ""), insight);
}

function compactEventLine(insight: SessionInsight): string {
  const peak = insight.detail.match(/^(.+?) peak\b/);
  if (insight.label === "Penalties") return insight.value;
  if (insight.label === "Power Unit Wear" && peak) {
    return `${peak[1]} wear: ${insight.value}`;
  }
  if (insight.label === "Race Incidents" && insight.detail) {
    return `${insight.label}: ${insight.detail}`;
  }
  if (insight.label === "Car Damage" && peak) {
    return `${insight.label}: ${insight.value} ${peak[1]} damage`;
  }
  return `${insight.label}: ${insight.value}`;
}

function compactEventItem(insight: SessionInsight): string {
  const peak = insight.detail.match(/^(.+?) peak\b/);
  if (insight.label === "Penalties") return insight.value;
  if (insight.label === "Power Unit Wear" && peak) {
    return `${insight.value} ${peak[1]} wear`;
  }
  if (insight.label === "Race Incidents" && insight.detail) {
    return insight.detail;
  }
  if (insight.label === "Car Damage" && peak) {
    return `${insight.value} ${peak[1]} damage`;
  }
  return insight.detail || `${insight.value} ${insight.label.toLowerCase()}`;
}

function uniqueLines(lines: (string | undefined)[]): string[] {
  return [...new Set(lines.filter((line): line is string => Boolean(line)))];
}

function startsWithLabel(insight: SessionInsight, label: string): boolean {
  return insight.label.toLowerCase().startsWith(label.toLowerCase());
}

function findByLabel(
  insights: SessionInsight[],
  label: string,
): SessionInsight | undefined {
  return insights.find((insight) => insight.label === label);
}

function takeByLabel(
  insights: SessionInsight[],
  label: string,
): SessionInsight | undefined {
  const index = insights.findIndex((insight) => insight.label === label);
  if (index === -1) return undefined;
  return insights.splice(index, 1)[0];
}

function takeWhere(
  insights: SessionInsight[],
  predicate: (insight: SessionInsight) => boolean,
): SessionInsight[] {
  const taken: SessionInsight[] = [];
  for (let index = insights.length - 1; index >= 0; index--) {
    const insight = insights[index];
    if (predicate(insight)) {
      taken.unshift(...insights.splice(index, 1));
    }
  }
  return taken;
}

function extractSectorLabel(label: string): string {
  return label.match(/S[1-3]/)?.[0] ?? label;
}

function extractSpeedValue(insight: SessionInsight): string | undefined {
  return insight.detail.match(/\b\d+\s*km\/h\b/)?.[0];
}

function extractTimeDelta(text: string): string | undefined {
  return text.match(/[+-]\d+(?:\.\d+)?s(?:\/lap)?/)?.[0];
}

function rankPosition(value: string): number | undefined {
  return Number(value.match(/\d+/)?.[0]) || undefined;
}

function compactRank(value: string, total?: number | string): string {
  const position = rankPosition(value);
  const suffix = total ? `/${total}` : "";
  return position ? `P${position}${suffix}` : `${value}${suffix}`;
}

function insightRank(
  insight: SessionInsight,
  totalOverride?: number | string,
): string {
  if (insight.rank != null) {
    const total = totalOverride ?? insight.rankTotal;
    return `P${insight.rank + 1}${total ? `/${total}` : ""}`;
  }
  return compactRank(insight.value, totalOverride);
}

function comparisonTarget(detail: string): string | undefined {
  return detail.match(/\b(?:vs|ahead of)\s+(.+)$/)?.[1];
}

function comparisonSuffix(detail: string): string | undefined {
  const target = comparisonTarget(detail);
  return target ? `vs ${target}` : undefined;
}

function rankedMetricLine(prefix: string, insight: SessionInsight): string {
  const rankedMetric = insight.detail.match(/^of\s+(\d+)\s+[—-]\s+(.+)$/);
  if (rankedMetric) {
    return `${prefix} ${rankedMetric[2]} · ${insightRank(insight, rankedMetric[1])}`;
  }

  return compactMetricLine(prefix, insight);
}

function sectorContext(
  insight: SessionInsight,
  role: "strongest" | "weakest",
): string {
  const comparison = comparisonSuffix(insight.detail);
  const roleLabel = role === "strongest" ? "best" : "weak";
  return `${extractSectorLabel(insight.label)} ${roleLabel} · ${insightRank(insight)}${comparison ? ` ${comparison}` : ""}`;
}

function compactFuelLoadLine(initial: SessionInsight): string {
  if (initial.value === "—") return initial.detail;
  const kg = initial.detail.match(/\b\d+(?:\.\d+)?\s*kg\b/)?.[0];
  return `Current ${initial.value}${kg ? ` · ${kg}` : ""}`;
}

function compactFuelRecommendationLine(
  recommended: SessionInsight | undefined,
): string | undefined {
  if (!recommended?.detail) return undefined;
  const spare = recommended.detail.match(
    /([+−-]?\d+(?:\.\d+)?)\s+laps?\s+spare/i,
  );
  if (spare) return `Clean buffer ${spare[1]} laps`;
  const short = recommended.detail.match(
    /([+−-]?\d+(?:\.\d+)?)\s+laps?\s+short/i,
  );
  if (short)
    return `Clean buffer −${Math.abs(Number(short[1])).toFixed(1)} laps`;
  if (/on target/i.test(recommended.detail)) return "Clean race on target";
  return recommended.detail.replace(/\s*\([^)]*\)\s*$/, "");
}

function mergeBestLapInsight(
  bestLap: SessionInsight | undefined,
  theoreticalBest: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!bestLap) return theoreticalBest;
  if (!theoreticalBest) return bestLap;

  // Theoretical best is useful context but too similar to Best Lap to spend a
  // full card on. Merge it so the primary lap story stays compact.
  return {
    ...bestLap,
    extraDetails: uniqueLines([
      ...(bestLap.extraDetails ?? []),
      compactMetricLine("Theoretical", theoreticalBest),
    ]),
  };
}

function timeTrialTheoreticalInsight(
  theoreticalBest: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!theoreticalBest) return undefined;

  return {
    ...theoreticalBest,
    accent: "purple",
    tone: "best",
  };
}

function timeTrialNewPersonalBest(
  historyInsights: SessionInsight[],
): SessionInsight | undefined {
  return historyInsights.find(
    (insight) =>
      insight.label === "vs Personal Best" && /^new pb!?$/i.test(insight.value),
  );
}

function compactPersonalBestImprovement(insight: SessionInsight): string {
  return insight.detail.replace(/\s+improvement$/i, "");
}

function mergeTimeTrialNewPersonalBestIntoLap(
  bestLap: SessionInsight | undefined,
  historyInsights: SessionInsight[],
): SessionInsight | undefined {
  if (!bestLap) return undefined;

  const personalBest = timeTrialNewPersonalBest(historyInsights);
  if (!personalBest) return bestLap;

  return {
    ...bestLap,
    detail: `New PB · ${compactPersonalBestImprovement(personalBest)}`,
    tone: "best",
    accent: "purple",
  };
}

function timeTrialTrackPersonalBestInsight(
  historyInsights: SessionInsight[],
): SessionInsight | undefined {
  const trackPb = historyInsights.find(
    (insight) => insight.label === "Track PB",
  );
  if (!trackPb) return undefined;

  return {
    ...trackPb,
    tone: /improvement|matched/i.test(trackPb.detail) ? "best" : "neutral",
    accent: "zinc",
  };
}

function mergeFuelInsights(
  fuelInsights: SessionInsight[],
): SessionInsight | undefined {
  const initial = findByLabel(fuelInsights, "Initial Fuel");
  const recommended = findByLabel(fuelInsights, "Recommended Fuel");
  const primary = recommended ?? initial;
  if (!primary) return undefined;

  const hasRecommendation = recommended && recommended.value !== "—";
  // Recommended fuel is the actionable value; current load is supporting
  // context. If recommendation is missing, keep the tile visible as a data-gap
  // signal rather than pretending the loaded fuel is a plan.
  return {
    type: "fuel",
    label: "Fuel Plan",
    value: hasRecommendation ? recommended.value : primary.value,
    detail: hasRecommendation ? "recommended start fuel" : "fuel data missing",
    tooltip: recommended?.tooltip ?? initial?.tooltip,
    accent: "amber",
    extraDetails: uniqueLines([
      initial ? compactFuelLoadLine(initial) : undefined,
      compactFuelRecommendationLine(recommended),
    ]),
  };
}

function mergeSectorInsights(
  sectorInsights: SessionInsight[],
): SessionInsight | undefined {
  if (sectorInsights.length === 0) return undefined;
  if (sectorInsights.length === 1) {
    const insight = sectorInsights[0];
    const isWeakest = startsWithLabel(insight, "Weakest");
    const isStrongest = startsWithLabel(insight, "Strongest");
    if (!isWeakest && !isStrongest) return insight;

    const sector = extractSectorLabel(insight.label);
    const delta = extractTimeDelta(insight.detail);
    return {
      ...insight,
      label: "Sector Split",
      value: isWeakest ? (delta ?? `${sector} weakest`) : `${sector} strongest`,
      detail: sectorContext(insight, isWeakest ? "weakest" : "strongest"),
      accent: "cyan",
    };
  }

  const strongest = sectorInsights.find((insight) =>
    startsWithLabel(insight, "Strongest"),
  );
  const weakest = sectorInsights.find((insight) =>
    startsWithLabel(insight, "Weakest"),
  );
  if (!strongest && !weakest) return sectorInsights[0];

  const primary = strongest ?? weakest;
  if (!primary) return sectorInsights[0];
  // Weakest sector gets the headline because it is the actionable loss. The
  // strongest sector remains as context so the driver still sees what worked.
  const primarySector = extractSectorLabel(primary.label);
  const weakestSector = weakest ? extractSectorLabel(weakest.label) : undefined;
  const weakestDelta = weakest ? extractTimeDelta(weakest.detail) : undefined;
  const weakestContext = weakest
    ? sectorContext(weakest, "weakest")
    : undefined;
  const strongestContext = strongest
    ? sectorContext(strongest, "strongest")
    : undefined;

  return {
    type: "sector",
    label: "Sector Split",
    value:
      weakestDelta ??
      (weakest ? `${weakestSector} weakest` : `${primarySector} strongest`),
    detail: weakestContext ?? primary.detail,
    tooltip: primary.tooltip,
    rank: weakest?.rank ?? primary.rank,
    rankTotal: weakest?.rankTotal ?? primary.rankTotal,
    accent: "cyan",
    extraDetails: uniqueLines([strongestContext]),
  };
}

function mergePowerInsights(
  speed: SessionInsight | undefined,
  ersInsights: SessionInsight[],
): SessionInsight | undefined {
  const deploy = findByLabel(ersInsights, "ERS Deploy");
  const harvest = findByLabel(ersInsights, "ERS Harv");
  const primary = speed ?? deploy ?? harvest;
  if (!primary) return undefined;

  if (!speed) {
    // Qualifying/time-trial exports sometimes have ERS but no reliable speed
    // sample; keep the power tile rather than dropping useful deploy/harvest
    // data.
    return {
      ...primary,
      label: deploy && harvest ? "ERS Usage" : primary.label,
      value: deploy ? deploy.value : primary.value,
      detail:
        deploy && harvest
          ? rankedMetricLine("Harvest", harvest)
          : primary.detail,
      extraDetails: uniqueLines([
        deploy ? rankedMetricLine("Deploy", deploy) : undefined,
      ]),
    };
  }

  const speedValue = extractSpeedValue(speed) ?? speed.value;
  const speedRank =
    speed.rank != null && speed.rankTotal != null
      ? `${insightRank(speed)}`
      : speed.detail;
  return {
    type: "speed",
    label: deploy || harvest ? "Speed & ERS" : "Top Speed",
    value: speedValue,
    detail: `${speedRank} top speed`,
    tooltip: speed.tooltip ?? deploy?.tooltip ?? harvest?.tooltip,
    rank: speed.rank,
    rankTotal: speed.rankTotal,
    accent: "sky",
    extraDetails: uniqueLines([
      deploy ? rankedMetricLine("Deploy", deploy) : undefined,
      harvest ? rankedMetricLine("Harvest", harvest) : undefined,
    ]),
  };
}

function mergeHistoryInsights(
  historyInsights: SessionInsight[],
): SessionInsight | undefined {
  if (historyInsights.length === 0) return undefined;
  if (historyInsights.length === 1) {
    const insight = historyInsights[0];
    const isPersonalBest = isHighValueHistory(insight);
    return {
      ...insight,
      label: "Personal Bests",
      value:
        insight.value === "New PB!" && /matched/i.test(insight.detail)
          ? "Matched PB"
          : insight.value,
      tone: isPersonalBest ? "best" : "neutral",
      accent: isPersonalBest ? "purple" : "zinc",
    };
  }

  const lap = historyInsights.find(
    (insight) =>
      insight.label === "vs Personal Best" ||
      insight.label === "vs Best Race Lap",
  );
  const highValue = historyInsights.find(isHighValueHistory);
  const primary = highValue ?? lap ?? historyInsights[0];
  const isPersonalBest = historyInsights.some(isHighValueHistory);

  return {
    type: "history",
    label: "Personal Bests",
    value:
      primary.value === "New PB!" && /matched/i.test(primary.detail)
        ? "Matched PB"
        : primary.value,
    detail: primary.detail,
    tooltip: primary.tooltip,
    tone: isPersonalBest ? "best" : "neutral",
    accent: isPersonalBest ? "purple" : "zinc",
    extraDetails: historyInsights
      .filter((insight) => insight !== primary)
      .map(compactHistoryLine),
  };
}

function mergeEventInsights(events: SessionInsight[]): SessionInsight[] {
  if (events.length <= 1) return events;

  const priority = [
    "Penalties",
    "Car Damage",
    "Power Unit Wear",
    "Race Incidents",
    "Neutralized Laps",
    "Conditions",
  ];
  const eventRank = (label: string) => {
    const index = priority.indexOf(label);
    return index === -1 ? priority.length : index;
  };
  const sorted = [...events].sort(
    (a, b) => eventRank(a.label) - eventRank(b.label),
  );
  const primary = sorted[0];
  const hasNegativeEvent = sorted.some(
    (insight) => insight.tone === "negative",
  );
  return [
    {
      type: primary.type,
      label: primary.groupLabel ?? "Session Events",
      groupLabel: primary.groupLabel,
      value: `${events.length} ${hasNegativeEvent ? "issues" : "notes"}`,
      detail: sorted.map(compactEventLine).join(" - "),
      tooltip: primary.tooltip,
      tone: hasNegativeEvent ? "negative" : "warning",
      accent: sorted.some((insight) => insight.accent === "rose")
        ? "rose"
        : "amber",
      extraDetails: sorted.map(compactEventItem),
    },
  ];
}

function isHighValueHistory(insight: SessionInsight | undefined): boolean {
  if (!insight) return false;

  const value = insight.value.toLowerCase();
  const detail = insight.detail.toLowerCase();
  return (
    /new pb|new best|matched pb|all-time bests/.test(value) ||
    /improvement|matched your best|gained across sectors/.test(detail)
  );
}

function appendIfPresent(
  target: SessionInsight[],
  insight: SessionInsight | undefined,
) {
  if (insight) target.push(insight);
}

export function curateSessionInsights(
  session: TelemetrySession,
  insights: SessionInsight[],
  limit = MAX_SESSION_INSIGHTS,
): SessionInsight[] {
  const isTimeTrial = isTimeTrialSessionType(
    session["session-info"]["session-type"],
  );
  const remaining = insights.filter(
    // Lap Quality was clear as a debug metric but noisy as a card; result/best
    // lap already explain whether the run produced useful timed laps.
    (insight) => insight.label !== "Lap Quality",
  );
  const result =
    takeByLabel(remaining, "Result") ??
    takeByLabel(remaining, "Timed Laps") ??
    takeByLabel(remaining, "Run Status");
  const bestLap = takeByLabel(remaining, "Best Lap");
  const theoreticalBest = takeByLabel(remaining, "Theoretical Best");
  const historyInsights = takeWhere(
    remaining,
    (insight) => insight.type === "history",
  );
  const timeTrialPersonalBest = isTimeTrial
    ? timeTrialNewPersonalBest(historyInsights)
    : undefined;
  const lap = isTimeTrial
    ? mergeTimeTrialNewPersonalBestIntoLap(bestLap, historyInsights)
    : mergeBestLapInsight(bestLap, theoreticalBest);
  const timeTrialTheoretical = isTimeTrial
    ? timeTrialTheoreticalInsight(theoreticalBest)
    : undefined;
  const timeTrialTrackPb = isTimeTrial
    ? timeTrialTrackPersonalBestInsight(historyInsights)
    : undefined;
  const raceFlow = takeByLabel(remaining, "Race Flow");
  const events = mergeEventInsights(
    takeWhere(
      remaining,
      (insight) => insight.type === "incident" || insight.type === "context",
    ),
  );
  const racePace = takeByLabel(remaining, "Race Pace");
  const tyre = takeByLabel(remaining, "Tyre Management");
  const qualifying = takeByLabel(remaining, "Qualifying");
  takeByLabel(remaining, "Consistency");
  const firstPit = takeByLabel(remaining, "First Pit Stop");
  const fuel = mergeFuelInsights(
    takeWhere(remaining, (insight) => insight.type === "fuel"),
  );
  const sectors = mergeSectorInsights(
    takeWhere(remaining, (insight) => insight.type === "sector"),
  );
  const power = mergePowerInsights(
    takeByLabel(remaining, "Top Speed"),
    takeWhere(remaining, (insight) => insight.type === "ers"),
  );
  const history = mergeHistoryInsights(
    timeTrialPersonalBest
      ? historyInsights.filter(
          (insight) =>
            insight !== timeTrialPersonalBest &&
            insight.label !== "vs PB Sectors",
        )
      : historyInsights,
  );

  const curated: SessionInsight[] = [];
  appendIfPresent(curated, result);
  appendIfPresent(curated, lap);
  appendIfPresent(curated, raceFlow);
  curated.push(...events);

  if (isRaceSession(session)) {
    appendIfPresent(curated, racePace);
    appendIfPresent(curated, tyre);
    appendIfPresent(curated, fuel);
    appendIfPresent(curated, sectors);
    appendIfPresent(curated, power);
    appendIfPresent(curated, firstPit);
    // Race screens already have many tactical cards, so history only earns a
    // slot when it is actually notable (PB/matched PB/new best style signals).
    if (isHighValueHistory(history)) appendIfPresent(curated, history);
  } else if (isTimeTrial) {
    // Time Trial is lap-first by nature: Key Insights shows run-level lap
    // potential and historical PBs, while Sector Benchmarks owns sector detail.
    curated.length = 0;
    appendIfPresent(curated, lap);
    appendIfPresent(curated, timeTrialTheoretical);
    appendIfPresent(curated, timeTrialTrackPb);
    appendIfPresent(curated, result);
    appendIfPresent(curated, sectors);
    appendIfPresent(curated, power);
    curated.push(...events);
  } else {
    appendIfPresent(curated, sectors);
    appendIfPresent(curated, power);
    appendIfPresent(curated, history);
    if (!result) appendIfPresent(curated, qualifying);
  }

  curated.push(...remaining);

  return curated.slice(0, limit);
}
