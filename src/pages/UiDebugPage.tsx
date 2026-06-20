import {
  ArrowUpDown,
  Circle,
  Cloud,
  Flag,
  Fuel,
  Gauge,
  Timer,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { CompoundStatCard } from "../components/CompoundStatCard";
import { DamageTimeline } from "../components/DamageTimeline";
import { LapTimeChart } from "../components/LapTimeChart";
import { PerformanceDeltaChart } from "../components/PerformanceDeltaChart";
import { PositionChart } from "../components/PositionChart";
import { SectorComparison } from "../components/SectorComparison";
import { SessionInsightsGrid } from "../components/SessionInsightsGrid";
import { StintDetailCards, StintTimeline } from "../components/StintTimeline";
import { TrackKeyInsights } from "../components/track/TrackKeyInsights";
import { TrackStrategySection } from "../components/track/TrackStrategySection";
import { TrackFlag } from "../components/TrackFlag";
import { TyreWearChart } from "../components/TyreWearChart";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { CompoundBadge } from "../components/ui/CompoundBadge";
import { CompoundSwatchLabel } from "../components/ui/CompoundSwatchLabel";
import { InsightDetail, InsightValue } from "../components/ui/InsightText";
import { InsightTile } from "../components/ui/InsightTile";
import { PillSelect } from "../components/ui/PillSelect";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { stintChipStyle, stintChipTextStyle } from "../components/ui/StintChip";
import type {
  CarDamage,
  CarStatus,
  LapHistoryEntry,
  OvertakeRecord,
  PerLapInfo,
  PositionHistoryEntry,
  TyreSetData,
  TyreStint,
  TyreStintBasic,
  TyreWearEntry,
} from "../types/telemetry";
import { cn } from "../utils/cn";
import { msToLapTime, msToSectorTime } from "../utils/format";
import type { TrackRivalBenchmark } from "../analysis/rivalStats";
import type { SessionInsight } from "../analysis/sessionInsightSummary";
import type {
  TrackRaceRecommendation,
  TrackStrategySuggestion,
} from "../utils/stats/trackStrategy";
import type { CumulativeDelta } from "../utils/stats/laps";

const COMPOUNDS = [
  "Soft",
  "Medium",
  "Hard",
  "Intermediate",
  "Wet",
  "C1",
  "C3",
  "C5",
];

const sampleInsights: SessionInsight[] = [
  {
    type: "result",
    label: "Result",
    value: "P1",
    detail: "Finished - 27/27 laps - 25 pts",
    accent: "amber",
    tone: "best",
    rank: 0,
    rankTotal: 22,
  },
  {
    type: "lap",
    label: "Best Lap",
    value: "1:21.736",
    detail: "session fastest",
    accent: "purple",
    tone: "best",
  },
  {
    type: "race-flow",
    label: "Race Flow",
    value: "+18 pos",
    detail: "started P19, finished P1 - 39 made, 20 lost",
    accent: "emerald",
    tone: "positive",
  },
  {
    type: "incident",
    label: "Penalties",
    value: "+12s",
    detail: "4 penalties applied",
    accent: "amber",
    tone: "warning",
  },
  {
    type: "pace",
    label: "Race Pace",
    value: "2nd",
    detail: "of 22 - +0.084s vs P1",
    accent: "emerald",
    rank: 1,
    rankTotal: 22,
    tooltip:
      "Average clean-lap pace excluding lap 1, pit laps, SC, and outliers.",
  },
  {
    type: "tyre",
    label: "Tyre Management",
    value: "20th",
    detail: "of 22 - +3.3%/lap vs best",
    accent: "lime",
    rank: 19,
    rankTotal: 22,
  },
  {
    type: "fuel",
    label: "Fuel Plan",
    value: "-2.7 laps",
    detail: "fuel slider recommendation",
    extraDetails: [
      "Loaded -0.9 laps (35 kg - 1.20 kg/lap avg)",
      "+2.2 laps spare in a clean race (27 green laps)",
    ],
    accent: "amber",
  },
  {
    type: "sector",
    label: "Sector Split",
    value: "+0.266s",
    detail: "S2 weakest - 8th of 22 vs LECLERC",
    extraDetails: ["S1 strongest - 1st of 22 ahead of LECLERC"],
    accent: "cyan",
    tone: "warning",
  },
  {
    type: "speed",
    label: "Speed & ERS",
    value: "350 km/h",
    detail: "15th of 22 top speed",
    extraDetails: [
      "Deploy: 7.0 MJ/lap (1st of 22)",
      "Harvest: 6.9 MJ/lap (1st of 22)",
    ],
    accent: "sky",
    tone: "negative",
    tooltip:
      "Top speed is the best non-glitched speed sample for the focused driver.",
  },
];

const trackStrategy: TrackStrategySuggestion = {
  compounds: ["Medium", "Hard"],
  stintLaps: [12, 15],
  pitWindows: [{ earliest: 11, latest: 13, target: 12 }],
  raceCount: 2,
  fullDistanceRaceCount: 1,
  isEvidenceBacked: true,
  fastStart: true,
};

const trackAlternative: TrackStrategySuggestion = {
  compounds: ["Hard", "Medium"],
  stintLaps: [15, 12],
  pitWindows: [{ earliest: 14, latest: 16, target: 15 }],
  raceCount: 1,
  fullDistanceRaceCount: 1,
  isEvidenceBacked: true,
  fastStart: false,
};

const trackRecommendation: TrackRaceRecommendation = {
  raceCount: 2,
  fullDistanceRaceCount: 1,
  hasEvidence: true,
  bestRaceLap: {
    bestLapMs: 81736,
    compound: "Hard",
    theoreticalBestMs: 81055,
    gapToTheoreticalMs: 681,
  },
  raceVsQualiDeltaMs: 1575,
  avgErsDeployMj: 7.4,
  recommended: trackStrategy,
  alternative: trackAlternative,
  fuelTarget: {
    recommendedDeltaLaps: -2.7,
    recommendedFuelKg: 32.9,
    burnRateKgPerLap: 1.2,
    excessAtFinishLaps: 2.2,
    raceCount: 1,
  },
  sinceLastRace: {
    bestLapDeltaMs: -2643,
    wearRateDelta: 1.66,
  },
};

const trackRivalBenchmark: TrackRivalBenchmark = {
  driverName: "LECLERC",
  team: "Ferrari",
  paceDeltaMs: 184,
  basis: "same-compound pace",
  raceCount: 2,
  lapSamples: 18,
};

const laps = buildLaps();
const rivalLaps = buildLaps(350);
const stints = [
  makeStint("Medium", 1, 6, 0, 8.2),
  makeStint("Hard", 7, 12, 0, 5.8),
];
const rivalStints = [
  makeStint("Medium", 1, 5, 0, 9.1),
  makeStint("Hard", 6, 12, 0, 6.5),
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

const positionHistory: PositionHistoryEntry[] = [
  makePositionHistory(
    "ALONSO",
    "Aston Martin",
    [19, 17, 15, 12, 9, 8, 6, 5, 3, 2, 2, 1, 1],
  ),
  makePositionHistory(
    "LECLERC",
    "Ferrari",
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
  ),
  makePositionHistory(
    "NORRIS",
    "McLaren",
    [2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4],
  ),
  makePositionHistory(
    "RUSSELL",
    "Mercedes",
    [5, 5, 4, 4, 4, 4, 3, 3, 5, 5, 5, 5, 5],
  ),
];

const overtakes: OvertakeRecord[] = [
  {
    "overtake-id": 1,
    "overtaking-driver-name": "ALONSO",
    "overtaken-driver-name": "RUSSELL",
    "overtaking-driver-lap": 8,
  },
  {
    "overtake-id": 2,
    "overtaking-driver-name": "LECLERC",
    "overtaken-driver-name": "ALONSO",
    "overtaking-driver-lap": 9,
  },
  {
    "overtake-id": 3,
    "overtaking-driver-name": "ALONSO",
    "overtaken-driver-name": "LECLERC",
    "overtaking-driver-lap": 11,
  },
];

const deltas: CumulativeDelta[] = Array.from({ length: 12 }, (_, index) => {
  const lap = index + 1;
  const lapDelta = lap < 4 ? 0.18 : lap < 8 ? -0.12 : -0.32;
  return {
    lap,
    delta: 1.2 - lap * 0.18 + (lap > 8 ? -0.24 : 0),
    lapDelta,
    s1Delta: lapDelta * 0.35,
    s2Delta: lapDelta * 0.4,
    s3Delta: lapDelta * 0.25,
    playerPit: lap === 7,
    rivalPit: lap === 6,
  };
});

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
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-100">
          UI Debug
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Static fixture page for iterating on core telemetry UI pieces without
          hunting for the perfect session file.
        </p>
      </header>

      <DebugSection file="src/components/SessionInsightsGrid.tsx">
        <SessionInsightsGrid
          insights={sampleInsights}
          hint="Race-style deck - podium, lap, fuel, sector, ERS, and warning states"
        />
      </DebugSection>

      <DebugSection file="src/components/track/TrackKeyInsights.tsx">
        <TrackKeyInsights
          recommendation={trackRecommendation}
          raceLengthLabel="27-lap"
          rivalBenchmark={trackRivalBenchmark}
        />
      </DebugSection>

      <DebugSection file="src/components/ui/InsightTile.tsx">
        <SectionHeader
          title="Insight Tile Accents"
          hint="Compact fixture deck for tone checks"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InsightTile title="Amber Fuel" icon={Fuel} accent="amber">
            <DebugHero
              value="-2.7 laps"
              detail="32.9 kg total - 1.20 kg/lap burn"
            />
          </InsightTile>
          <InsightTile title="Purple Best" icon={Timer} accent="purple">
            <DebugHero
              value="1:21.736"
              detail="session fastest"
              tone="text-best"
            />
          </InsightTile>
          <InsightTile title="Emerald Gain" icon={ArrowUpDown} accent="emerald">
            <DebugHero
              value="+18 pos"
              detail="started P19, finished P1"
              tone="text-ahead"
            />
          </InsightTile>
          <InsightTile title="Rose Risk" icon={Circle} accent="rose">
            <DebugHero
              value="20th"
              detail="of 22 - +3.3%/lap vs best"
              tone="text-behind"
            />
          </InsightTile>
          <InsightTile title="Cyan Sector" icon={Zap} accent="cyan">
            <DebugHero
              value="+0.266s"
              detail="S2 weakest - 8th of 22"
              tone="text-cyan-300"
            />
          </InsightTile>
          <InsightTile title="Sky Speed" icon={Gauge} accent="sky">
            <DebugHero
              value="350 km/h"
              detail="15th of 22 top speed"
              tone="text-sky-300"
            />
          </InsightTile>
          <InsightTile title="Zinc Neutral" icon={Flag} accent="zinc">
            <DebugHero value="P2" detail="Finished - 33/33 laps" />
          </InsightTile>
          <InsightTile title="Context" icon={Cloud}>
            <DebugHero value="Clear" detail="Track 35C - Air 24C" />
          </InsightTile>
        </div>
      </DebugSection>

      <DebugSection
        files={[
          "Badge.tsx",
          "Button.tsx",
          "CompoundBadge.tsx",
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
              <div className="flex flex-wrap items-center gap-2">
                <DebugVariantLabel>sm</DebugVariantLabel>
                <Badge tone="zinc">Neutral</Badge>
                <Badge tone="amber">Warning</Badge>
                <Badge tone="green">Valid</Badge>
                <Badge tone="rose">Penalty</Badge>
                <Badge tone="purple">Best</Badge>
                <Badge tone="sky">Online</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
              </div>
            </div>
          </div>
          <div>
            <DebugComponentLabel>Button.tsx</DebugComponentLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="subtle">Subtle</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button size="sm">Small</Button>
              <Button size="xs" variant="ghost">
                Tiny
              </Button>
            </div>
          </div>
          <div>
            <DebugComponentLabel>CompoundBadge.tsx</DebugComponentLabel>
            <div className="flex flex-wrap gap-2">
              {COMPOUNDS.map((compound) => (
                <CompoundBadge key={compound} compound={compound} />
              ))}
            </div>
          </div>
          <div>
            <DebugComponentLabel>CompoundSwatchLabel.tsx</DebugComponentLabel>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {COMPOUNDS.slice(0, 5).map((compound) => (
                <CompoundSwatchLabel key={compound} compound={compound} />
              ))}
              <CompoundSwatchLabel
                compound="Hard"
                size="xs"
                labelClassName="text-zinc-500"
              />
            </div>
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
                <InsightDetail size="sm" tone="text-zinc-500" className="mt-1">
                  same tyres · clean laps
                </InsightDetail>
              </div>
              <div>
                <DebugVariantLabel className="w-auto">
                  value sm
                </DebugVariantLabel>
                <InsightValue size="sm" tone="text-warning">
                  Mario_Cavallaro_
                </InsightValue>
                <InsightDetail size="xs" tone="text-zinc-500" className="mt-1">
                  compact fallback
                </InsightDetail>
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
            <div className="flex flex-wrap items-end gap-6">
              {(["tiny", "small", "medium", "large"] as const).map((size) => (
                <div key={size} className="flex items-center gap-2">
                  <TrackFlag track="monza" size={size} />
                  <DebugVariantLabel className="w-auto">
                    {size}
                  </DebugVariantLabel>
                </div>
              ))}
            </div>
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
          totalLaps={27}
          raceLengthLabel="27-lap"
        />
      </DebugSection>

      <DebugSection file="src/components/StintTimeline.tsx">
        <StintTimeline stints={stints} totalLaps={12} />
      </DebugSection>

      <DebugSection file="src/components/CompoundStatCard.tsx">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Soft", "Medium", "Hard"].map((compound, index) => (
            <CompoundStatCard
              key={compound}
              compound={compound}
              subtitle={`${6 + index * 3} laps`}
              hero={{ value: `~${10 + index * 6}`, label: "pit by lap" }}
              rows={[
                { label: "Best lap", value: msToLapTime(82200 + index * 380) },
                {
                  label: "Avg wear",
                  value: `${(7.8 - index * 2.1).toFixed(1)}%/lap`,
                },
                {
                  label: "Stints",
                  value: `${6 + index * 3}-${9 + index * 4} laps`,
                },
              ]}
              progress={{ ratio: 0.42 + index * 0.18 }}
            />
          ))}
        </div>
      </DebugSection>

      <DebugSection file="src/components/StintTimeline.tsx / StintDetailCards">
        <StintDetailCards stints={stints} laps={laps} />
      </DebugSection>

      <DebugSection file="src/components/LapTimeChart.tsx">
        <LapTimeChart
          laps={laps}
          rivalLaps={rivalLaps}
          rivalName="LECLERC"
          pitLaps={[7]}
          perLapInfo={perLapInfo}
          damageLaps={[8]}
          stints={stints}
        />
      </DebugSection>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DebugSection file="src/components/PositionChart.tsx">
          <PositionChart
            positionHistory={positionHistory}
            playerName="ALONSO"
            rivalName="LECLERC"
            overtakes={overtakes}
          />
        </DebugSection>

        <DebugSection file="src/components/TyreWearChart.tsx">
          <TyreWearChart
            stints={stints}
            rivalStints={rivalStints}
            rivalName="LECLERC"
            perLapInfo={perLapInfo}
          />
        </DebugSection>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DebugSection file="src/components/DamageTimeline.tsx">
          <DamageTimeline perLapInfo={perLapInfo} />
        </DebugSection>

        <DebugSection file="src/components/PerformanceDeltaChart.tsx">
          <PerformanceDeltaChart deltas={deltas} rivalName="LECLERC" />
        </DebugSection>
      </div>

      <DebugSection file="src/components/SectorComparison.tsx">
        <SectorComparison
          laps={laps.slice(0, 5)}
          stints={basicStints}
          perLapInfo={perLapInfo.slice(0, 5)}
        />
      </DebugSection>
    </div>
  );
}

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
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <DebugCodeChip key={label}>{label}</DebugCodeChip>
          ))}
        </div>
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
    <code className="inline-flex rounded-md bg-zinc-950/55 px-1.5 py-0.5 font-mono text-2xs leading-none text-zinc-500 ring-1 ring-white/[0.04]">
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
        "w-14 font-mono text-2xs leading-none text-zinc-600",
        className,
      )}
    >
      {children}
    </span>
  );
}

function DebugHero({
  value,
  detail,
  tone = "text-zinc-100",
}: {
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <>
      <InsightValue tone={tone}>{value}</InsightValue>
      <InsightDetail className="mt-1.5">{detail}</InsightDetail>
    </>
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
      "top-speed-kmph": 322 + lap * 2 + (lap === 9 ? 12 : 0),
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

function makePositionHistory(
  name: string,
  team: string,
  positions: number[],
): PositionHistoryEntry {
  return {
    name,
    team,
    "driver-number": 14,
    "driver-position-history": positions.map((position, lap) => ({
      "lap-number": lap,
      position,
    })),
  };
}
