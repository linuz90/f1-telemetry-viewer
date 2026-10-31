import { useMemo, type CSSProperties } from "react";
import {
  compareStints,
  STINT_MATCHED_MS,
  STINT_SAME_WEAR_PER_LAP,
  stintCandidates,
  stintHistory,
  type ComparableStint,
  type StintCompareLaps,
  type StintComparison,
} from "../../analysis/stintCompare";
import type { StintCompareModel } from "../../hooks/useStintComparison";
import { LapChartLegend, type LapChartTooltipRow } from "../charts/LapChart";
import { PillSelect, type PillSelectOption } from "../ui/PillSelect";
import { getCompoundColor } from "../../utils/colors";
import { msToLapTime } from "../../utils/format";
import { PUNCTURE_THRESHOLD } from "../../utils/stats/tyres";
import { cn } from "../../utils/cn";
import { insetTileClass } from "../ui/surfaces";

/** Earlier runs a progression row shows before this one; the rest are in
 *  the picker. */
export const PROGRESSION_TILES = 3;

export const signedSeconds = (ms: number, digits = 3) =>
  `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${(Math.abs(ms) / 1000).toFixed(digits)}`;

export const signedPercent = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(1)}`;

/** A fade in s/lap without a "−0.00" for a flat stint; a stint that got
 *  quicker reads with a true minus, like the other deltas. */
const fadeText = (fade: number) =>
  (Math.abs(fade) < 0.005 ? 0 : fade).toFixed(2).replace("-", "−");

/** Gaining (green), losing (red), or level (neutral) for a time delta. */
export function paceTone(ms: number | null | undefined, level = 0): string {
  if (ms == null || Math.abs(ms) <= level) return "text-tone-400";
  return ms < 0 ? "text-ahead" : "text-behind";
}

/** More wear a lap is the loss. */
export function wearTone(delta: number | null | undefined): string {
  if (delta == null || Math.abs(delta) < STINT_SAME_WEAR_PER_LAP)
    return "text-tone-400";
  return delta < 0 ? "text-ahead" : "text-behind";
}

const stintRange = (s: ComparableStint) => `L${s.startLap}–${s.endLap}`;

/** "This run" vs "18:24 run": the pair the chart, table and line show. */
export function StintComparePicker({ model }: { model: StintCompareModel }) {
  const { stints, active, compare, pool, select, label, defaults } = model;
  if (!active) return null;
  const candidates = stintCandidates(active, stints, pool);
  const option = (s: ComparableStint, group: string): PillSelectOption => ({
    value: s.id,
    group,
    label: `${label(s)} · ${s.compound} ${stintRange(s)}${s.averageMs ? ` · ${msToLapTime(s.averageMs)}` : ""}`,
  });
  const options = [
    ...candidates.sameSession.map((s) =>
      option(s, active.kind === "long-run" ? "This run" : "This race"),
    ),
    ...candidates.sameCompound.map((s) =>
      option(s, `${active.compound}s, ${active.raceLaps}-lap races here`),
    ),
    ...candidates.otherCompounds.map((s) =>
      option(s, "Other compounds, paired by tyre age"),
    ),
  ];
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {stints.length > 1 && (
        <PillSelect
          size="sm"
          ariaLabel="Stint"
          value={active.id}
          dotColor={getCompoundColor(active.compound)}
          options={stints.map((s) => ({
            value: s.id,
            label: `${s.compound} ${stintRange(s)}`,
          }))}
          onChange={(id) =>
            select(id, defaults.find((d) => d.a.id === id)?.b.id ?? null)
          }
        />
      )}
      <span className="text-xs text-tone-500">
        {stints.length > 1 ? "vs" : "Compare with"}
      </span>
      <PillSelect
        size="sm"
        ariaLabel="Compare with"
        value={compare?.id ?? "none"}
        dotColor={compare ? "var(--color-chart-compare)" : undefined}
        options={[{ value: "none", label: "No comparison" }, ...options]}
        onChange={(id) => select(active.id, id === "none" ? null : id)}
      />
    </div>
  );
}

/** The comparison in one line: legend, pace, wear, fade and setup. */
export function StintCompareLine({
  model,
  className,
}: {
  model: StintCompareModel;
  className?: string;
}) {
  const c = model.comparison;
  if (!c) return null;
  const { a, b } = c;
  const self =
    a.kind === "long-run" ? "This run" : `This race ${stintRange(a)}`;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tone-400",
        className,
      )}
    >
      <LapChartLegend
        items={[
          { tone: "you", label: a.slug === b.slug ? stintRange(a) : self },
          { tone: "compare", label: model.label(b) },
        ]}
      />
      {c.deltaMs != null ? (
        <span>
          <b
            className={cn(
              "font-mono font-semibold",
              paceTone(c.deltaMs, STINT_MATCHED_MS),
            )}
          >
            {signedSeconds(c.deltaMs)}
          </b>{" "}
          s a lap over {c.pairs.length} laps paired by tyre age
          {c.fuelCorrected ? ", on equal fuel" : ""}
        </span>
      ) : (
        <span>Too few laps paired by tyre age for a pace delta</span>
      )}
      {c.wearPerLapDelta != null && (
        <span>
          wear{" "}
          <b className="font-semibold text-tone-100">
            {a.wearPerLap.toFixed(1)}%
          </b>{" "}
          a lap{" "}
          <span className={wearTone(c.wearPerLapDelta)}>
            {signedPercent(c.wearPerLapDelta)}
          </span>
        </span>
      )}
      {c.fadeDeltaS != null && (
        <span>
          fade{" "}
          <b className="font-semibold text-tone-100">
            {fadeText(a.fadeSPerLap!)}
          </b>{" "}
          s a lap against {fadeText(b.fadeSPerLap!)}
        </span>
      )}
      {c.setupNote && <span>{c.setupNote.replace(/\.$/, "")}</span>}
    </div>
  );
}

/** Tooltip rows for the compared stint at one of this session's laps. */
export function stintCompareTooltipRows(
  placed: StintCompareLaps,
  lap: number,
  label: string,
): LapChartTooltipRow[] {
  const rows: LapChartTooltipRow[] = [];
  const ms = placed.lapsMs[lap - 1];
  if (ms != null)
    rows.push({
      tone: "compare",
      value: msToLapTime(ms),
      label: `${label}, lap ${placed.lapB[lap - 1]}${placed.excluded.has(lap) ? " · not counted" : ""}`,
    });
  const delta = placed.deltaMs[lap - 1];
  const gap = placed.gapMs[lap - 1];
  if (delta != null && gap != null)
    rows.push({
      value: `${signedSeconds(delta)} s`,
      label: `lap delta · gap ${signedSeconds(gap, 2)} s`,
    });
  const wear = placed.wearDelta[lap - 1];
  if (wear != null)
    rows.push({ value: `${signedPercent(wear)}%`, label: `wear vs ${label}` });
  return rows;
}

function CompoundDot({ compound }: { compound: string }) {
  return (
    <span
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: getCompoundColor(compound) }}
    />
  );
}

/** One step of the progression: the stint against the one before it. */
function StepDelta({
  step,
  className,
}: {
  step: StintComparison | null;
  className?: string;
}) {
  if (step?.deltaMs == null) return null;
  return (
    <span
      className={cn(
        "font-mono text-xs font-medium",
        paceTone(step.deltaMs, STINT_MATCHED_MS),
        className,
      )}
      title={`Against the run before, ${step.pairs.length} laps paired by tyre age`}
    >
      {signedSeconds(step.deltaMs)}
    </span>
  );
}

function WearLine({
  stint,
  step,
  life,
}: {
  stint: ComparableStint;
  step: StintComparison | null;
  life?: boolean;
}) {
  if (stint.wearPerLap <= 0) return null;
  return (
    <span>
      <b className="font-semibold text-tone-50">
        {stint.wearPerLap.toFixed(1)}%
      </b>{" "}
      {step?.wearPerLapDelta != null && (
        <span className={cn("mr-1", wearTone(step.wearPerLapDelta))}>
          {signedPercent(step.wearPerLapDelta)}
        </span>
      )}
      wear a lap
      {life && stint.lifeLaps > 0 && (
        <>
          {" "}
          · <b className="font-semibold text-tone-50">
            ~{stint.lifeLaps} laps
          </b>{" "}
          to {PUNCTURE_THRESHOLD}%
        </>
      )}
    </span>
  );
}

/** This session's stint: pace, wear and life, and how it moved on the last. */
export function StintCard({
  stint,
  step,
  tag,
  className,
}: {
  stint: ComparableStint;
  step?: StintComparison | null;
  tag?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        insetTileClass,
        "p-4",
        tag && "bg-tone-900 ring-2 ring-chart-you/50",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <CompoundDot compound={stint.compound} />
        <b className="font-semibold text-tone-50">{stint.compound}</b>
        <span className="ml-auto text-xs text-tone-500">
          laps {stint.startLap}–{stint.endLap}
        </span>
        {tag && (
          <span className="rounded-full bg-chart-you/10 px-2 py-0.5 text-[11px] font-semibold text-chart-you">
            {tag}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-semibold tracking-tight text-tone-50">
          {stint.averageMs ? msToLapTime(stint.averageMs) : "—"}
        </span>
        <StepDelta step={step ?? null} className="text-sm" />
      </div>
      <div className="text-xs text-tone-500">
        {stint.averageMs
          ? `average, ${stint.cleanLaps} clean laps`
          : "too few clean laps"}{" "}
        · best {stint.bestMs ? msToLapTime(stint.bestMs) : "—"}
        {stint.fadeSPerLap != null &&
          ` · fade ${fadeText(stint.fadeSPerLap)} s/lap`}
      </div>
      <div className="mt-3 border-t border-tone-800 pt-2.5 text-sm text-tone-400">
        <WearLine stint={stint} step={step ?? null} life />
      </div>
      {step?.setupNote && (
        <div className="mt-1.5 text-xs text-tone-500">{step.setupNote}</div>
      )}
    </div>
  );
}

/** An earlier run in the progression; picking it compares this run with it. */
function RunTile({
  stint,
  step,
  label,
  selected,
  onSelect,
}: {
  stint: ComparableStint;
  step: StintComparison | null;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex flex-col rounded-xl p-3 text-left ring-1 transition-colors",
        selected
          ? "bg-tone-900 ring-chart-compare/45"
          : "bg-tone-800/25 ring-tone-800 hover:bg-tone-800/50",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <b className="font-semibold text-tone-100">{label}</b>
        <span className="text-tone-500">
          {stint.endLap - stint.startLap + 1} laps
        </span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
            selected
              ? "bg-chart-compare/10 text-chart-compare"
              : "text-tone-500 opacity-0 ring-1 ring-tone-700 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {selected ? "vs" : "compare"}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-mono text-xl font-semibold tracking-tight text-tone-100">
          {stint.averageMs ? msToLapTime(stint.averageMs) : "—"}
        </span>
        <StepDelta step={step} />
      </div>
      <div className="mt-1 flex flex-col gap-0.5 text-xs text-tone-500">
        <WearLine stint={stint} step={step} />
        {stint.fadeSPerLap != null && (
          <span>
            fade{" "}
            <b className="font-semibold text-tone-200">
              {fadeText(stint.fadeSPerLap)}
            </b>{" "}
            s/lap
          </span>
        )}
      </div>
      {step?.setupNote && (
        <div className="mt-auto pt-2 text-[11px] text-tone-500">
          <div className="border-t border-tone-800 pt-1.5">
            {step.setupNote}
          </div>
        </div>
      )}
    </button>
  );
}

/**
 * A stint beside its earlier runs on the same tyre here, oldest first, each
 * against the one before: is the driver getting faster, and at what wear?
 * Without earlier runs it is just the stint's card.
 */
export function StintProgression({
  model,
  stint,
  trackName,
}: {
  model: StintCompareModel;
  stint: ComparableStint;
  trackName: string;
}) {
  const history = useMemo(
    () => stintHistory(stint, model.pool),
    [stint, model.pool],
  );
  const shown = history.slice(-PROGRESSION_TILES);
  const steps = useMemo(() => {
    const tiles = history.slice(-PROGRESSION_TILES);
    const before = history[history.length - tiles.length - 1];
    return [...tiles, stint].map((s, i, all) => {
      const previous = i === 0 ? before : all[i - 1];
      return previous ? compareStints(s, previous) : null;
    });
  }, [history, stint]);
  const comparing = model.active?.id === stint.id && !!model.compare;

  if (shown.length === 0)
    return <StintCard stint={stint} tag={comparing ? "this run" : undefined} />;

  const word = [stint, ...shown].every((s) => s.kind === "long-run")
    ? "runs"
    : "stints";
  const columns = {
    "--stint-cols": `repeat(${shown.length}, minmax(0, 1fr)) minmax(0, 1.35fr)`,
  } as CSSProperties;
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-tone-500">
        <span className="flex items-center gap-2 self-center">
          <CompoundDot compound={stint.compound} />
          <b className="text-sm font-semibold text-tone-100">
            {stint.compound} {word} at {trackName}
          </b>
        </span>
        <span>
          {stint.raceLaps}-lap race
          {history.length > shown.length &&
            ` · last ${shown.length} of ${history.length} earlier`}{" "}
          · each against the one before, laps paired by tyre age
        </span>
      </div>
      <div
        className="grid gap-2 sm:grid-cols-2 lg:[grid-template-columns:var(--stint-cols)]"
        style={columns}
      >
        {shown.map((s, i) => (
          <RunTile
            key={s.id}
            stint={s}
            step={steps[i]}
            label={model.label(s)}
            selected={comparing && model.compare?.id === s.id}
            onSelect={() => model.select(stint.id, s.id)}
          />
        ))}
        <StintCard
          stint={stint}
          step={steps[shown.length]}
          tag={
            comparing
              ? stint.kind === "long-run"
                ? "this run"
                : "this race"
              : undefined
          }
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>
    </div>
  );
}
