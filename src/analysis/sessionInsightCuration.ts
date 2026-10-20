import type { TelemetrySession } from "../types/telemetry";
import { isRaceSession, isTimeTrialSessionType } from "../utils/sessionTypes";
import type { SessionInsight } from "./sessionInsightSummary";

/**
 * Product rules for turning raw session facts into a compact card grid. This is
 * where related facts share a card (result + race flow, tyres + fuel + pit
 * timing, speed + ERS, events) and supporting evidence moves into tooltips so a
 * race page never shows more than two short rows; telemetry extraction itself
 * stays in `sessionInsightSummary`.
 */

// Two rows of three on desktop. Every race-page topic has a home inside this
// budget, so the set of cards does not change with the number of incidents.
const MAX_SESSION_INSIGHTS = 6;

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

function joinTooltips(tooltips: (string | undefined)[]): string | undefined {
  return (
    uniqueLines(tooltips)
      .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
      .join(" ") || undefined
  );
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

function mergeErsInsights(
  ersInsights: SessionInsight[],
): SessionInsight | undefined {
  const deploy = findByLabel(ersInsights, "ERS Deploy");
  const harvest =
    findByLabel(ersInsights, "ERS Harvest") ??
    findByLabel(ersInsights, "ERS Harv");
  const primary = deploy ?? harvest;
  if (!primary) return undefined;
  const tooltip = joinTooltips([deploy?.tooltip, harvest?.tooltip]);

  // ERS stands alone only when there is no Speed card to join (head-to-head
  // pages, sparse exports); otherwise `mergeSpeedAndErs` folds it under speed.
  return {
    ...primary,
    label: deploy && harvest ? "ERS Usage" : primary.label,
    value: deploy ? deploy.value : primary.value,
    detail:
      deploy && harvest ? rankedMetricLine("Harvest", harvest) : primary.detail,
    tooltip,
    extraDetails: uniqueLines([
      deploy ? rankedMetricLine("Deploy", deploy) : undefined,
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

function mergeResultAndRaceFlow(
  result: SessionInsight | undefined,
  raceFlow: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!result) return raceFlow;
  if (!raceFlow) return result;

  // Grid-to-finish movement and passes are the story behind the finishing
  // position. "P3 to P11" already implies the signed move, so the value is
  // kept only when there was no grid position to anchor it.
  const hasGridMove = /^P\d+ to P\d+/.test(raceFlow.detail);
  return {
    ...result,
    extraDetails: uniqueLines([
      ...(result.extraDetails ?? []),
      hasGridMove ? raceFlow.detail : `${raceFlow.value} · ${raceFlow.detail}`,
    ]),
  };
}

function personalBestLine(insight: SessionInsight): string {
  if (/matched/i.test(insight.detail)) {
    return insight.detail.replace(/^./, (char) => char.toUpperCase());
  }
  return `${insight.value.replace(/!$/, "")} · ${insight.detail}`;
}

function mergeBestLapWithPersonalBest(
  lap: SessionInsight | undefined,
  personalBest: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!lap || !personalBest) return lap;

  // A new all-time race lap reads purple like a session-best lap: both mean
  // "fastest", and the card keeps its session delta as the primary detail.
  return {
    ...lap,
    tone: "best",
    accent: "purple",
    extraDetails: uniqueLines([
      ...(lap.extraDetails ?? []),
      personalBestLine(personalBest),
    ]),
  };
}

function mergePaceInsights(
  pace: SessionInsight | undefined,
  personalBest: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!pace || !personalBest) return pace;
  return {
    ...pace,
    extraDetails: uniqueLines([
      ...(pace.extraDetails ?? []),
      personalBestLine(personalBest),
    ]),
  };
}

const FUEL_MARGIN_TOOLTIP =
  "Fuel margin is the game's own estimate at the last recorded lap, not a viewer recommendation.";

function mergeTyreInsights(
  tyre: SessionInsight | undefined,
  fuel: SessionInsight | undefined,
  firstPit: SessionInsight | undefined,
): SessionInsight | undefined {
  if (!tyre) return fuel ?? firstPit;

  // Tyre wear, pit timing and fuel margin all answer "how did I manage the
  // car"; tyre rank keeps the headline because it is the only ranked metric.
  // Fuel keeps one line, the game's signed margin; tank and burn evidence sits
  // in the tooltip instead of three more rows on the card.
  const lines = uniqueLines([
    ...(tyre.extraDetails ?? []),
    firstPit
      ? `First stop ${firstPit.value.toLowerCase()} · ${firstPit.detail}`
      : undefined,
    fuel
      ? fuel.value === "—"
        ? `Fuel ${fuel.detail}`
        : `Fuel ${fuel.value} · ${fuel.detail}`
      : undefined,
  ]);
  if (lines.length === 0) return tyre;
  return {
    ...tyre,
    label: fuel ? "Tyres & Fuel" : tyre.label,
    tooltip: fuel
      ? joinTooltips([
          tyre.tooltip,
          FUEL_MARGIN_TOOLTIP,
          ...(fuel.extraDetails ?? []),
        ])
      : tyre.tooltip,
    extraDetails: lines,
  };
}

interface ErsFact {
  line: string;
  tooltip?: string;
}

function ersFacts(ersInsights: SessionInsight[]): ErsFact[] {
  const deploy = findByLabel(ersInsights, "ERS Deploy");
  const harvest = findByLabel(ersInsights, "ERS Harvest");
  const harvestEnergy = findByLabel(ersInsights, "ERS Harv");
  const facts: (ErsFact | undefined)[] = [
    deploy
      ? { line: rankedMetricLine("ERS deploy", deploy), tooltip: deploy.tooltip }
      : undefined,
    harvest
      ? {
          line: `ERS harvest ${harvest.value} of the MGU-K limit · ${harvest.detail}`,
        }
      : undefined,
    harvestEnergy
      ? {
          line: rankedMetricLine("ERS harvest", harvestEnergy),
          tooltip: harvestEnergy.tooltip,
        }
      : undefined,
  ];
  return facts.filter((fact): fact is ErsFact => fact != null);
}

function mergeSpeedAndErs(
  speed: SessionInsight | undefined,
  ersInsights: SessionInsight[],
): SessionInsight | undefined {
  if (!speed) return mergeErsInsights(ersInsights);
  const [primary, ...secondary] = ersFacts(ersInsights);
  if (!primary) return speed;

  // Peak speed and ERS deployment are one straight-line story in F1 26, where
  // deploy energy sets the peak. Speed keeps the headline and its rank, the
  // first ERS fact (deploy when present) gets a line, and harvest, which sits
  // near 100% on most laps, moves to the tooltip. ERS rows come from typed
  // ERS facts, never from parsing the speed copy.
  return {
    ...speed,
    label: "Speed & ERS",
    tooltip: joinTooltips([
      speed.tooltip,
      primary.tooltip,
      ...secondary.map((fact) => fact.line),
    ]),
    extraDetails: uniqueLines([...(speed.extraDetails ?? []), primary.line]),
  };
}

export function curateSessionInsights(
  session: TelemetrySession,
  insights: SessionInsight[],
  limit?: number,
): SessionInsight[] {
  const isRace = isRaceSession(session);
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
  // Race pages have no room for a history card, so only notable PBs survive,
  // folded under the lap or pace they improve on.
  const raceLapPersonalBest = isRace
    ? historyInsights.find(
        (insight) =>
          insight.label === "vs Best Race Lap" && isHighValueHistory(insight),
      )
    : undefined;
  const racePacePersonalBest = isRace
    ? historyInsights.find(
        (insight) =>
          insight.label === "Race Pace vs Best" && isHighValueHistory(insight),
      )
    : undefined;
  const lap = isTimeTrial
    ? mergeTimeTrialNewPersonalBestIntoLap(bestLap, historyInsights)
    : mergeBestLapWithPersonalBest(
        mergeBestLapInsight(bestLap, theoreticalBest),
        raceLapPersonalBest,
      );
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
  const racePace =
    takeByLabel(remaining, "Race Pace") ??
    takeByLabel(remaining, "Matched Pace");
  const tyre = takeByLabel(remaining, "Tyre Management");
  const qualifying = takeByLabel(remaining, "Qualifying");
  takeByLabel(remaining, "Consistency");
  const firstPit = takeByLabel(remaining, "First Pit Stop");
  const fuel = takeByLabel(remaining, "Fuel Margin");
  const sectorInsights = takeWhere(
    remaining,
    (insight) => insight.type === "sector",
  );
  const speed = takeByLabel(remaining, "Speed Profile");
  const ersInsights = takeWhere(
    remaining,
    (insight) => insight.type === "ers",
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

  // Events close every list so the first cards keep their places whether or
  // not the session had incidents.
  const curated: SessionInsight[] = [];
  if (isRace) {
    // Whole-race sector averages are not actionable on a race page, so the
    // race sector facts are taken off the list above and dropped here;
    // qualifying keeps its one-lap Sector Split card.
    appendIfPresent(curated, mergeResultAndRaceFlow(result, raceFlow));
    appendIfPresent(curated, lap);
    appendIfPresent(curated, mergePaceInsights(racePace, racePacePersonalBest));
    appendIfPresent(curated, mergeTyreInsights(tyre, fuel, firstPit));
    appendIfPresent(curated, mergeSpeedAndErs(speed, ersInsights));
    curated.push(...events);
  } else if (isTimeTrial) {
    // Time Trial is lap-first by nature: Key Insights shows run-level lap
    // potential and historical PBs, while Sector Benchmarks owns sector detail.
    appendIfPresent(curated, lap);
    appendIfPresent(curated, timeTrialTheoretical);
    appendIfPresent(curated, timeTrialTrackPb);
    appendIfPresent(curated, result);
    appendIfPresent(curated, mergeSectorInsights(sectorInsights));
    appendIfPresent(curated, mergeSpeedAndErs(speed, ersInsights));
    curated.push(...events);
  } else {
    appendIfPresent(curated, result);
    appendIfPresent(curated, lap);
    appendIfPresent(curated, mergeSectorInsights(sectorInsights));
    appendIfPresent(curated, mergeSpeedAndErs(speed, ersInsights));
    appendIfPresent(curated, history);
    if (!result) appendIfPresent(curated, qualifying);
    curated.push(...events);
  }

  curated.push(...remaining);
  return curated.slice(0, limit ?? MAX_SESSION_INSIGHTS);
}
