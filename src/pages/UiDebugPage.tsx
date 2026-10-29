import { Flag, Gauge, Search, Timer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Card } from "../components/Card";
import { CompoundStatCard } from "../components/CompoundStatCard";
import { TyreLifeEvidenceBar } from "../components/track/TyreLifeEvidenceBar";
import { LapComparisonView } from "../components/lap-telemetry/LapComparisonView";
import type { SlotLap } from "../components/lap-telemetry/types";
import { DamageTimeline } from "../components/DamageTimeline";
import { LapChart, LapChartLegend } from "../components/charts/LapChart";
import { WorthList } from "../components/session/SessionParts";
import { SectorComparison } from "../components/SectorComparison";
import { TrackStrategySection } from "../components/track/TrackStrategySection";
import { TrackFlag } from "../components/TrackFlag";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { CompoundSwatchLabel } from "../components/ui/CompoundSwatchLabel";
import { Input } from "../components/ui/Input";
import { InsightDetail, InsightValue } from "../components/ui/InsightText";
import { PillSelect } from "../components/ui/PillSelect";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { HStack } from "../components/ui/Stack";
import { stintChipStyle, stintChipTextStyle } from "../components/ui/StintChip";
import type {
  CarDamage,
  CarStatus,
  LapHistoryEntry,
  PerLapInfo,
  TyreSetData,
  TyreStint,
  TyreStintBasic,
  TyreWearEntry,
} from "../types/telemetry";
import { cn } from "../utils/cn";
import { msToLapTime, msToSectorTime } from "../utils/format";
import { PEAK_PACE_LABEL, PEAK_PACE_TOOLTIP } from "../utils/stats/peakPace";
import { PUNCTURE_THRESHOLD } from "../utils/stats/tyres";
import type { TrackStrategySuggestion } from "../analysis/trackStrategyTypes";
import { prepareLap } from "../analysis/lapTelemetryAnalysis";
import type { WorthItem } from "../analysis/worthALook";
import type { LapCandidate } from "../analysis/lapTelemetrySelection";
import { LAP_SLOT_COLORS } from "../constants/colors";
import {
  syntheticLap,
  type SyntheticLapOptions,
} from "../utils/lapRecording/syntheticLap";

const COMPOUNDS = ["Soft", "Medium", "Hard", "Inters", "Wet", "C1", "C3", "C5"];

const trackStrategy: TrackStrategySuggestion = {
  compounds: ["Medium", "Hard", "Medium"],
  stintLaps: [9, 9, 9],
  stintWearPercentages: [58, 42, 58],
  pitWindows: [
    { earliest: 8, latest: 10, target: 9 },
    { earliest: 17, latest: 19, target: 18 },
  ],
  raceCount: 2,
  fullDistanceRaceCount: 1,
  isEvidenceBacked: true,
  timeEstimate: {
    predictedTotalRaceMs: 2482_200,
    deltaToFastestMs: 0,
    pitLossMs: 19_000,
    confidence: "medium",
    source: "anchored to your completed race",
    details: {
      pitLossSource: "Pits n' Giggles Austria default",
      paceSource: "distance-matched tyre-set deltas",
      anchorSource: "latest completed race anchor",
    },
  },
};

const trackAlternative: TrackStrategySuggestion = {
  compounds: ["Medium", "Hard"],
  stintLaps: [12, 15],
  stintWearPercentages: [68, 78.2],
  pitWindows: [{ earliest: 11, latest: 13, target: 12 }],
  raceCount: 1,
  fullDistanceRaceCount: 1,
  isEvidenceBacked: true,
  fastStart: true,
  timeEstimate: {
    predictedTotalRaceMs: 2488_900,
    deltaToFastestMs: 6700,
    pitLossMs: 19_000,
    confidence: "medium",
    source: "anchored to your completed race",
    details: {
      pitLossSource: "Pits n' Giggles Austria default",
      paceSource: "distance-matched tyre-set deltas",
      anchorSource: "latest completed race anchor",
    },
  },
  risk: {
    kind: "managed-tyres",
    projectedMaxWear: 78.2,
    overThreshold: 3.2,
    limitingCompound: "Hard",
    limitingStintLaps: 15,
  },
};

const trackWetStrategy: TrackStrategySuggestion = {
  compounds: ["Inters", "Inters"],
  stintLaps: [13, 14],
  stintWearPercentages: [52, 57],
  pitWindows: [{ earliest: 12, latest: 14, target: 13 }],
  raceCount: 2,
  fullDistanceRaceCount: 1,
  isEvidenceBacked: true,
  timeEstimate: {
    deltaToFastestMs: 0,
    pitLossMs: 19_000,
    confidence: "medium",
    source: "relative tyre/wear/pit model",
    details: {
      pitLossSource: "Pits n' Giggles Austria default",
      paceSource: "Inters-only stop-count comparison",
    },
  },
  closeStopCount: { stopCount: 2, deltaMs: 2_200 },
};

const trackFullWetStrategy: TrackStrategySuggestion = {
  compounds: ["Wet"],
  stintLaps: [27],
  stintWearPercentages: [48],
  pitWindows: [],
  raceCount: 2,
  fullDistanceRaceCount: 1,
  isEvidenceBacked: true,
  timeEstimate: {
    deltaToFastestMs: 0,
    pitLossMs: 19_000,
    confidence: "low",
    source: "relative tyre/wear/pit model",
    details: {
      pitLossSource: "Pits n' Giggles Austria default",
      paceSource:
        "Wet-only stop-count comparison; wear extrapolated past your 8-lap longest Wet stint",
    },
  },
};

const laps = buildLaps();
const stints = [
  makeStint("Medium", 1, 6, 0, 8.2),
  makeStint("Hard", 7, 12, 0, 5.8),
];
const perLapInfo = buildPerLapInfo();
const basicStints: TyreStintBasic[] = [
  {
    "tyre-actual-compound": "C3",
    "tyre-visual-compound": "Medium",
    "end-lap": 6,
  },
  {
    "tyre-actual-compound": "C2",
    "tyre-visual-compound": "Hard",
    "end-lap": 12,
  },
];

const worthItems: WorthItem[] = [
  {
    id: "start",
    tone: "loss",
    claim: "Lost 4 places at the start, from P2 to P6.",
    evidence: "Reaction 0.284 s; the cars around you averaged 0.21 s.",
    target: "laps",
    targetLabel: "Laps",
    weight: 4,
  },
  {
    id: "pace",
    tone: "gain",
    claim: "Race pace 3rd of 20, better than the P9 result.",
    evidence: "1:32.418 over 22 laps, 0.212 s off the best.",
    target: "results",
    targetLabel: "Results",
    weight: 3,
  },
  {
    id: "sector",
    tone: "note",
    claim: "Sector 3 is where the fastest lap got away: 0.231 s.",
    target: "lap-telemetry",
    targetLabel: "Lap telemetry",
    weight: 0.2,
  },
];

export function UiDebugPage() {
  const [compactSegment, setCompactSegment] = useState("race");
  const [pageSegment, setPageSegment] = useState("sessions");
  const [compactPill, setCompactPill] = useState("leclerc");
  const [sessionPill, setSessionPill] = useState("alonso");

  return (
    <div className="mx-auto max-w-7xl space-y-14 px-6 py-10 lg:px-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-300">
          dev-only route
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-tone-100">
          UI Debug
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-tone-500">
          Static fixture page for iterating on core telemetry UI pieces without
          hunting for the perfect session file.
        </p>
      </header>

      <DebugSection
        files={[
          "Badge.tsx",
          "Button.tsx",
          "CompoundSwatchLabel.tsx",
          "InsightText.tsx",
          "SegmentedControl.tsx",
          "TrackFlag.tsx",
          "StintChip.tsx",
        ]}
      >
        <div className="space-y-8">
          <SectionHeader
            title="Badges, Controls & Chips"
            hint="Small UI variants, explicit sizes, and compound styling"
          />
          <div>
            <DebugComponentLabel>Badge.tsx</DebugComponentLabel>
            <div className="space-y-4">
              <HStack wrap className="gap-2">
                <DebugVariantLabel>sm</DebugVariantLabel>
                <Badge tone="zinc">Neutral</Badge>
                <Badge tone="amber">Warning</Badge>
                <Badge tone="green">Valid</Badge>
                <Badge tone="rose">Penalty</Badge>
                <Badge tone="purple">Best</Badge>
                <Badge tone="sky">Online</Badge>
              </HStack>
              <HStack wrap className="gap-2">
                <DebugVariantLabel>xs</DebugVariantLabel>
                <Badge tone="zinc" size="xs">
                  PIT
                </Badge>
                <Badge tone="amber" size="xs">
                  SC
                </Badge>
                <Badge tone="green" size="xs">
                  VALID
                </Badge>
                <Badge tone="red" size="xs" shape="square">
                  INVALID
                </Badge>
                <Badge tone="purple" size="xs" shape="square">
                  BEST
                </Badge>
              </HStack>
            </div>
          </div>
          <div>
            <DebugComponentLabel>Button.tsx</DebugComponentLabel>
            <HStack wrap className="gap-2">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="subtle">Subtle</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button size="sm">Small</Button>
              <Button size="xs" variant="ghost">
                Tiny
              </Button>
            </HStack>
          </div>
          <div>
            <DebugComponentLabel>CompoundSwatchLabel.tsx</DebugComponentLabel>
            <HStack wrap className="gap-x-4 gap-y-2">
              {COMPOUNDS.slice(0, 5).map((compound) => (
                <CompoundSwatchLabel key={compound} compound={compound} />
              ))}
              <CompoundSwatchLabel
                compound="Hard"
                size="xs"
                labelClassName="text-tone-500"
              />
            </HStack>
          </div>
          <div>
            <DebugComponentLabel>InsightText.tsx</DebugComponentLabel>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <DebugVariantLabel className="w-auto">
                  value lg
                </DebugVariantLabel>
                <InsightValue tone="text-best">1:21.736</InsightValue>
                <InsightDetail className="mt-1">session fastest</InsightDetail>
              </div>
              <div>
                <DebugVariantLabel className="w-auto">
                  value md
                </DebugVariantLabel>
                <InsightValue size="md" tone="text-ahead">
                  Faster by 0.410s
                </InsightValue>
                <InsightDetail size="sm" tone="text-tone-500" className="mt-1">
                  same tyres · race-pace laps
                </InsightDetail>
              </div>
              <div>
                <DebugVariantLabel className="w-auto">
                  value sm
                </DebugVariantLabel>
                <InsightValue size="sm" tone="text-warning">
                  Mario_Cavallaro_
                </InsightValue>
                <InsightDetail size="xs" tone="text-tone-500" className="mt-1">
                  compact fallback
                </InsightDetail>
              </div>
            </div>
          </div>
          <div>
            <DebugComponentLabel>Input.tsx</DebugComponentLabel>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-1.5">
                <DebugVariantLabel className="w-auto">sm</DebugVariantLabel>
                <Input
                  size="sm"
                  aria-label="Small debug input"
                  placeholder="Search sessions..."
                  defaultValue="Madrid"
                  leftAdornment={<Search aria-hidden="true" />}
                />
              </div>
              <div className="space-y-1.5">
                <DebugVariantLabel className="w-auto">md</DebugVariantLabel>
                <Input
                  size="md"
                  aria-label="Medium debug input"
                  placeholder="Search sessions..."
                  defaultValue="Catalunya"
                  leftAdornment={<Search aria-hidden="true" />}
                />
              </div>
            </div>
          </div>
          <div>
            <DebugComponentLabel>PillSelect.tsx</DebugComponentLabel>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-1.5">
                <DebugVariantLabel className="w-auto">
                  sm / compact
                </DebugVariantLabel>
                <PillSelect
                  ariaLabel="Compact pill select"
                  size="sm"
                  width="compact"
                  value={compactPill}
                  onChange={setCompactPill}
                  dotColor="#ef4444"
                  options={[
                    { value: "leclerc", label: "P2 LECLERC - Ferrari '26" },
                    { value: "hamilton", label: "P4 HAMILTON - Ferrari '26" },
                    { value: "norris", label: "P5 NORRIS - Mclaren '26" },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <DebugVariantLabel className="w-auto">
                  md / session
                </DebugVariantLabel>
                <PillSelect
                  ariaLabel="Session pill select"
                  width="session"
                  value={sessionPill}
                  onChange={setSessionPill}
                  dotColor="#22c55e"
                  options={[
                    {
                      value: "alonso",
                      label: "P1 ALONSO - Aston Martin '26 (You)",
                    },
                    { value: "leclerc", label: "P2 LECLERC - Ferrari '26" },
                    { value: "hadjar", label: "P3 HADJAR - Red Bull '26" },
                  ]}
                />
              </div>
            </div>
          </div>
          <div>
            <DebugComponentLabel>SegmentedControl.tsx</DebugComponentLabel>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-1.5">
                <DebugVariantLabel className="w-auto">sm</DebugVariantLabel>
                <SegmentedControl
                  ariaLabel="Small segmented control"
                  size="sm"
                  value={compactSegment}
                  onChange={setCompactSegment}
                  options={[
                    { value: "race", label: "Race", meta: 27, icon: Flag },
                    { value: "quali", label: "Quali", meta: 4, icon: Timer },
                    { value: "tt", label: "TT", meta: 12, icon: Gauge },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <DebugVariantLabel className="w-auto">md</DebugVariantLabel>
                <SegmentedControl
                  ariaLabel="Medium segmented control"
                  size="md"
                  value={pageSegment}
                  onChange={setPageSegment}
                  fullWidth
                  options={[
                    { value: "sessions", label: "Sessions", meta: 53 },
                    { value: "tracks", label: "Tracks", meta: 18 },
                    { value: "rivals", label: "Rivals", meta: 9 },
                  ]}
                />
              </div>
            </div>
          </div>
          <div>
            <DebugComponentLabel>TrackFlag.tsx</DebugComponentLabel>
            <HStack align="end" wrap className="gap-6">
              {(["tiny", "smaller", "small", "medium", "large"] as const).map(
                (size) => (
                  <HStack key={size} className="gap-2">
                    <TrackFlag track="Monza" size={size} />
                    <DebugVariantLabel className="w-auto">
                      {size}
                    </DebugVariantLabel>
                  </HStack>
                ),
              )}
            </HStack>
          </div>
          <div>
            <DebugComponentLabel>StintChip.tsx</DebugComponentLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {COMPOUNDS.slice(0, 5).map((compound, index) => (
                <div
                  key={compound}
                  className="flex h-9 items-center justify-center rounded-md text-xs font-semibold"
                  style={stintChipStyle(compound)}
                >
                  <span style={stintChipTextStyle(compound)}>
                    {compound[0]} - L{index * 4 + 1}-{index * 4 + 4}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DebugSection>

      <DebugSection file="src/components/track/TrackStrategySection.tsx">
        <TrackStrategySection
          recommended={trackStrategy}
          alternative={trackAlternative}
          wetStrategies={[trackWetStrategy]}
          totalLaps={27}
          raceLengthLabel="27-lap"
        />
      </DebugSection>

      <DebugSection file="src/components/track/TrackStrategySection.tsx (wet only)">
        <TrackStrategySection
          recommended={null}
          alternative={null}
          wetStrategies={[trackWetStrategy, trackFullWetStrategy]}
          totalLaps={27}
          raceLengthLabel="27-lap"
        />
      </DebugSection>

      <DebugSection file="src/components/CompoundStatCard.tsx">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Soft", "Medium", "Hard"].map((compound, index) => (
            <CompoundStatCard
              key={compound}
              compound={compound}
              subtitle={`${3 - index} stint${index === 2 ? "" : "s"}`}
              hero={{
                value: `~${10 + index * 6} laps`,
                label: `to ${PUNCTURE_THRESHOLD}% wear`,
              }}
              belowHero={
                <TyreLifeEvidenceBar
                  compound={compound}
                  seenLaps={6 + index * 3}
                  seenWear={48 + index * 6}
                  estLife={10 + index * 6}
                />
              }
              rows={[
                {
                  label: "Best lap",
                  value: msToLapTime(82200 + index * 380),
                  className: "font-mono text-best",
                  divider: true,
                },
                {
                  label: PEAK_PACE_LABEL,
                  note: `${12 + index * 4} laps`,
                  tooltip: PEAK_PACE_TOOLTIP,
                  value: msToLapTime(82900 + index * 410),
                },
                {
                  label: "Wear",
                  value: `${(7.8 - index * 2.1).toFixed(1)}%/lap`,
                  divider: true,
                },
                { label: "Avg stint", value: `${5 + index * 3} laps` },
              ]}
            />
          ))}
        </div>
      </DebugSection>

      <DebugSection file="src/components/charts/LapChart.tsx">
        <Card as="section" className="space-y-4">
          <LapChartLegend
            items={[
              { tone: "you", label: "ALONSO" },
              { tone: "compare", label: "LECLERC" },
            ]}
          />
          <LapChart
            laps={12}
            bands={[{ from: 5, to: 6, label: "VSC" }]}
            pits={[6]}
            stints={stints.map((stint) => ({
              from: stint["start-lap"],
              to: stint["end-lap"],
              compound: stint["tyre-set-data"]["visual-tyre-compound"],
            }))}
            events={[{ lap: 8, kind: "contact" }]}
            panels={[
              {
                kind: "position",
                height: 120,
                trace: [12, 10, 9, 8, 8, 6, 9, 7, 5, 4, 3, 3, 2],
                maxPosition: 20,
                endLabel: "P2",
              },
              {
                kind: "time",
                height: 160,
                series: [
                  {
                    key: "you",
                    tone: "you",
                    lapsMs: laps.map((lap) => lap["lap-time-in-ms"]),
                    excluded: new Map([
                      [1, "start"],
                      [5, "VSC"],
                      [6, "VSC"],
                      [7, "invalid"],
                    ]),
                    averages: [
                      { from: 2, to: 4, ms: 82_600 },
                      { from: 8, to: 12, ms: 82_360 },
                    ],
                  },
                  {
                    key: "compare",
                    tone: "compare",
                    lapsMs: laps.map((lap) => lap["lap-time-in-ms"] + 350),
                  },
                ],
              },
              {
                kind: "wear",
                height: 80,
                wear: laps.map((_, index) =>
                  index < 6 ? (index + 1) * 8.2 : (index - 5) * 5.8,
                ),
              },
            ]}
          />
        </Card>
      </DebugSection>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DebugSection file="src/components/session/SessionParts.tsx (WorthList)">
          <WorthList items={worthItems} onOpen={() => {}} />
        </DebugSection>

        <DebugSection file="src/components/DamageTimeline.tsx">
          <DamageTimeline perLapInfo={perLapInfo} />
        </DebugSection>
      </div>

      <DebugSection file="src/components/SectorComparison.tsx">
        <SectorComparison
          laps={laps.slice(0, 5)}
          stints={basicStints}
          perLapInfo={perLapInfo.slice(0, 5)}
        />
      </DebugSection>

      <DebugSection file="src/components/lap-telemetry/LapComparisonView.tsx">
        <Card as="section" className="space-y-4">
          <LapComparisonView
            slots={lapTelemetryFixture.slots}
            laps={lapTelemetryFixture.laps}
            sectorStarts={[1757, 3179]}
            track="Melbourne"
          />
        </Card>
      </DebugSection>
    </div>
  );
}

/**
 * Synthetic Melbourne-length laps with known causes: lap A brakes 25 m early
 * into Turn 3 (1.12 km) and arrives at the back straight with half the
 * battery, so the tips list shows one braking and one battery item.
 */
const lapTelemetryFixture = (() => {
  const trackLengthM = 5276;
  const corners: SyntheticLapOptions["corners"] = [
    { apex: 400, minKmh: 190 },
    { apex: 1120, minKmh: 105 },
    { apex: 2470, minKmh: 160 },
    { apex: 4160, minKmh: 122 },
    { apex: 4660, minKmh: 96 },
  ];
  const deploy = (stored: number) => (d: number) =>
    d < 2800 ? stored : Math.max(0, stored - ((d - 2800) / 900) * 1_500_000);
  const variants: [string, string, number, Partial<SyntheticLapOptions>][] = [
    [
      "A",
      "RUSSELL",
      21,
      {
        corners: corners.map((corner) =>
          corner.apex === 1120 ? { ...corner, brakeFor: 175 } : corner,
        ),
        battery: deploy(750_000),
        speedLoss: (d) =>
          d > 3250 && d < 4000 ? Math.min(9, (d - 3250) * 0.03) : 0,
      },
    ],
    ["B", "LECLERC", 16, { battery: deploy(1_500_000) }],
  ];
  const laps = variants.map(([key, driverName, index, options]) => {
    const lap = syntheticLap({ trackLengthM, corners, ...options });
    const trace = Object.fromEntries(
      Object.entries(lap.channels).map(([name, values]) => [
        name,
        Float32Array.from(values),
      ]),
    );
    return prepareLap(
      trace,
      {
        key,
        driverName,
        team: index === 21 ? "Mercedes '26" : "Ferrari '26",
        isPlayer: index === 21,
        sessionType: "Short Qualifying",
        lapNumber: 1,
        lapTimeMs: lap.lapTimeMs,
        compound: "Soft",
        weather: "Clear",
      },
      trackLengthM,
    );
  });
  const slots: SlotLap[] = laps.map((lap, index) => {
    const candidate: LapCandidate = {
      ref: {
        recordingSlug: "fixture",
        driverIndex: index === 0 ? 21 : 16,
        lapNumber: 1,
      },
      lapTimeMs: lap.context.lapTimeMs,
      driverName: lap.context.driverName,
      team: lap.context.team,
      isPlayer: lap.context.isPlayer,
      isFriend: false,
      compound: "Soft",
      recording: {
        slug: "fixture",
        sessionType: "Short Qualifying",
        track: "Melbourne",
        date: "2026-10-05T20:49:14",
        trackLengthM,
        completeLapCount: 2,
        drivers: [],
      },
      eligible: true,
      valid: true,
      pitLap: false,
      standingStart: false,
    };
    return {
      slot: index === 0 ? "A" : "B",
      key: lap.context.key,
      color: LAP_SLOT_COLORS[index],
      label: index === 0 ? "You" : "Leclerc",
      candidate,
      detail: "Lap 1 · Soft",
    };
  });
  return { laps, slots };
})();

function DebugSection({
  file,
  files,
  children,
}: {
  file?: string;
  files?: string[];
  children: ReactNode;
}) {
  const labels = files ?? (file ? [file] : []);

  return (
    <section className="space-y-4">
      {labels.length > 0 && (
        <HStack align="stretch" wrap className="gap-1.5">
          {labels.map((label) => (
            <DebugCodeChip key={label}>{label}</DebugCodeChip>
          ))}
        </HStack>
      )}
      {children}
    </section>
  );
}

function DebugComponentLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3">
      <DebugCodeChip>{children}</DebugCodeChip>
    </div>
  );
}

function DebugCodeChip({ children }: { children: ReactNode }) {
  return (
    <code className="inline-flex rounded-md bg-tone-950/55 px-1.5 py-0.5 font-mono text-2xs leading-none text-tone-500 ring-1 ring-tone-0/[0.04]">
      {children}
    </code>
  );
}

function DebugVariantLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "w-14 font-mono text-2xs leading-none text-tone-600",
        className,
      )}
    >
      {children}
    </span>
  );
}

function buildLaps(offsetMs = 0): LapHistoryEntry[] {
  const times = [
    84020, 83180, 82540, 81980, 83060, 84680, 86220, 82110, 81736, 82390, 82610,
    82840,
  ];
  return times.map((time, index) =>
    makeLap(time + offsetMs + index * 24, index !== 6),
  );
}

function makeLap(timeMs: number, valid = true): LapHistoryEntry {
  const s1 = Math.round(timeMs * 0.275);
  const s2 = Math.round(timeMs * 0.37);
  const s3 = timeMs - s1 - s2;
  return {
    "lap-time-in-ms": timeMs,
    "lap-time-str": msToLapTime(timeMs),
    "sector-1-time-in-ms": s1,
    "sector-1-time-str": msToSectorTime(s1),
    "sector-2-time-in-ms": s2,
    "sector-2-time-str": msToSectorTime(s2),
    "sector-3-time-in-ms": s3,
    "sector-3-time-str": msToSectorTime(s3),
    "lap-valid-bit-flags": valid ? 15 : 0,
  };
}

function makeStint(
  compound: string,
  startLap: number,
  endLap: number,
  baseWear: number,
  wearPerLap: number,
): TyreStint {
  const length = endLap - startLap + 1;
  return {
    "start-lap": startLap,
    "end-lap": endLap,
    "stint-length": length,
    "fitted-index": startLap,
    "tyre-set-key": `${compound}-${startLap}`,
    "tyre-set-data": makeTyreSetData(compound),
    "tyre-wear-history": Array.from({ length }, (_, index) =>
      makeWearEntry(startLap + index, baseWear + (index + 1) * wearPerLap),
    ),
  };
}

function makeTyreSetData(compound: string): TyreSetData {
  return {
    "actual-tyre-compound": compound,
    "visual-tyre-compound": compound,
    wear: 0,
    available: true,
    "recommended-session": "Race",
    "life-span": 24,
    "usable-life": 18,
    "lap-delta-time": 0,
    fitted: true,
  };
}

function makeWearEntry(lap: number, wear: number): TyreWearEntry {
  const clamped = Math.min(wear, 95);
  return {
    "lap-number": lap,
    "front-left-wear": clamped * 0.88,
    "front-right-wear": clamped * 0.92,
    "rear-left-wear": clamped,
    "rear-right-wear": clamped * 0.96,
    average: clamped * 0.94,
    desc: `${clamped.toFixed(1)}%`,
  };
}

function buildPerLapInfo(): PerLapInfo[] {
  return Array.from({ length: 12 }, (_, index) => {
    const lap = index + 1;
    const damage = lap < 8 ? 0 : (lap - 7) * 6;
    return {
      "lap-number": lap,
      "car-damage-data": makeDamage(damage, lap === 11),
      "car-status-data": makeStatus(lap),
      "ers-stats": {
        "ers-deployed-j": (5.4 + (lap % 4) * 0.55) * 1_000_000,
        "ers-harv-mguk-j": (2.1 + (lap % 3) * 0.28) * 1_000_000,
        "ers-harv-mguh-j": (2.4 + (lap % 2) * 0.36) * 1_000_000,
      },
      "max-safety-car-status":
        lap === 5 || lap === 6 ? "VIRTUAL_SAFETY_CAR" : "NO_SAFETY_CAR",
      "track-position": Math.max(1, 20 - lap * 2),
      // Deliberately impossible sample exercises the canonical glitch filter
      // and ensures debug UI never leaks a rejected peak.
      "top-speed-kmph": lap === 9 ? 486 : 322 + lap * 2,
    };
  });
}

function makeDamage(level: number, fault: boolean): CarDamage {
  return {
    "tyres-wear": [level, level + 1, level + 2, level + 1],
    "tyres-damage": [0, 0, 0, 0],
    "front-left-wing-damage": level,
    "front-right-wing-damage": Math.max(0, level - 4),
    "rear-wing-damage": Math.max(0, level - 10),
    "floor-damage": Math.max(0, level - 6),
    "diffuser-damage": Math.max(0, level - 12),
    "sidepod-damage": Math.max(0, level - 15),
    "engine-damage": Math.max(0, level - 18),
    "gear-box-damage": Math.max(0, level - 20),
    "drs-fault": fault,
    "ers-fault": false,
    "engine-blown": false,
    "engine-seized": false,
  };
}

function makeStatus(lap: number): CarStatus {
  return {
    "actual-tyre-compound": lap < 7 ? "Medium" : "Hard",
    "visual-tyre-compound": lap < 7 ? "Medium" : "Hard",
    "tyres-age-laps": lap < 7 ? lap : lap - 6,
    "fuel-in-tank": Math.max(2, 38 - lap * 1.18),
    "fuel-remaining-laps": 5.2 - lap * 0.62,
    "fuel-capacity": 110,
    "engine-power-ice": 1000,
    "engine-power-mguk": 350,
    "ers-store-energy": 3_500_000 - lap * 80_000,
    "ers-deploy-mode": "Hotlap",
    "ers-harvested-this-lap-mguk": 2_100_000,
    "ers-harvested-this-lap-mguh": 2_400_000,
    "ers-harvested-limit-per-lap": 8_000_000,
    "ers-deployed-this-lap": 5_800_000,
    "ers-max-capacity": 4_000_000,
  };
}
