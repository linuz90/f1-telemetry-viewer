import {
  BatteryMedium,
  ChevronsDown,
  ChevronsUp,
  CircleAlert,
  CircleCheck,
  MoveRight,
  Spline,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  TIP_FLOOR_S,
  type LapComparison,
  type LapTip,
  type TipCategory,
} from "../../analysis/lapTelemetryAnalysis";
import { cn } from "../../utils/cn";
import { Eyebrow } from "../ui/Eyebrow";
import { ScrollArea } from "../ui/ScrollArea";

/**
 * Glyph before each tip's title, so the categories scan as shapes down the
 * list. There is no common throttle or brake icon, so the pedals read as a
 * pair: chevrons down for slowing into a corner, up for powering out of it.
 */
const CATEGORY_ICONS: Record<TipCategory, LucideIcon> = {
  Battery: BatteryMedium,
  Braking: ChevronsDown,
  "Mid-corner": Spline,
  Exit: ChevronsUp,
  Straight: MoveRight,
};

function signed(value: number, unit = ""): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(3)}${unit}`;
}

function timeClass(value: number): string {
  return value > 0 ? "text-behind" : value < 0 ? "text-ahead" : "text-zinc-400";
}

/** Whether a tip lost or gained time; the map colours stretches by it. */
export function tipTone(tip: Pick<LapTip, "timeS">): "behind" | "ahead" {
  return tip.timeS > 0 ? "behind" : "ahead";
}

/** Consecutive tips that share a sector, in lap order. */
function groupBySector(tips: readonly LapTip[]) {
  const groups: {
    sector?: 1 | 2 | 3;
    tips: { tip: LapTip; number: number }[];
  }[] = [];
  tips.forEach((tip, index) => {
    const last = groups[groups.length - 1];
    const entry = { tip, number: index + 1 };
    if (last && last.sector === tip.sector) last.tips.push(entry);
    else groups.push({ sector: tip.sector, tips: [entry] });
  });
  return groups;
}

/**
 * Fades whichever edge of the tips list has more rows beyond it, so a capped
 * list reads as scrollable without a visible frame.
 */
function useEdgeFade(ref: RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Same object when nothing changed, so scrolling does not re-render.
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((current) =>
        current.top === top && current.bottom === bottom
          ? current
          : { top, bottom },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref]);
  if (!edges.top && !edges.bottom) return undefined;
  const mask = `linear-gradient(to bottom, ${edges.top ? "transparent, black 1.5rem" : "black"}, ${edges.bottom ? "black calc(100% - 2.5rem), transparent" : "black"})`;
  return { maskImage: mask, WebkitMaskImage: mask } satisfies CSSProperties;
}

export function LapTipsList({
  comparison,
  comparisonName,
  sectorDeltasS,
  selectedTipId,
  hoveredTipId,
  onSelectTip,
  onHoverTip,
}: {
  comparison: LapComparison;
  /** "Leclerc", "you" or "your other lap" */
  comparisonName: string;
  /** Lap A minus lap B per sector, summing to the gap at the line. */
  sectorDeltasS?: readonly [number, number, number];
  selectedTipId: string | null;
  /** Set from the track map, so hovering a stretch lights up its row. */
  hoveredTipId: string | null;
  onSelectTip: (tip: LapTip | null) => void;
  onHoverTip: (tip: LapTip | null) => void;
}) {
  const { tips, comparability, remainderS, remainderCount, totalS } =
    comparison;
  // Lap order hides which item matters most; a bar scaled to the largest
  // time keeps that readable at a glance.
  const largest = Math.max(...tips.map((tip) => Math.abs(tip.timeS)), 0);
  const differs = comparability.filter((item) => item.tone === "differs");
  const same = comparability.filter((item) => item.tone === "same");
  const groups = groupBySector(tips);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const fade = useEdgeFade(scrollRef);
  // A tip picked on the map can sit below the fold of the capped list.
  useEffect(() => {
    const container = scrollRef.current;
    const row = selectedTipId ? rowRefs.current.get(selectedTipId) : undefined;
    if (!container || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTo({ top: top - 32, behavior: "smooth" });
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({
        top: bottom - container.clientHeight + 32,
        behavior: "smooth",
      });
    }
  }, [selectedTipId]);

  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-2.5">
        <span
          className={cn(
            "font-mono text-2xl font-semibold tabular-nums tracking-tight",
            timeClass(totalS),
          )}
        >
          {signed(totalS, " s")}
        </span>
        <span className="text-sm text-zinc-400">
          {totalS > 0 ? "behind" : totalS < 0 ? "ahead of" : "level with"}{" "}
          {comparisonName} at the line
        </span>
      </p>
      {comparability.length > 0 && (
        // Only the mismatches compete for attention; what matches stays in
        // the tooltip unless nothing differs.
        <p
          className="mt-1 flex items-start gap-1.5 text-xs text-zinc-500"
          title={
            differs.length > 0 && same.length > 0
              ? same.map((item) => item.label).join(" · ")
              : undefined
          }
        >
          {differs.length > 0 ? (
            <CircleAlert className="mt-0.5 size-3 shrink-0 text-amber-300" />
          ) : (
            <CircleCheck className="mt-0.5 size-3 shrink-0 text-zinc-600" />
          )}
          {(differs.length > 0 ? differs : same)
            .map((item) => item.label)
            .join(" · ")}
        </p>
      )}

      {tips.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">
          No stretch differs by {"≥"}
          {TIP_FLOOR_S} s, the smallest gap the recording measures reliably.
        </p>
      ) : (
        <ScrollArea
          ref={scrollRef}
          tone="subtle"
          className="relative mt-3 max-h-100"
          style={fade}
        >
          {groups.map((group, groupIndex) => (
            <section key={`${group.sector ?? "lap"}-${groupIndex}`}>
              {group.sector && sectorDeltasS && (
                <div
                  className={cn(
                    "flex items-baseline justify-between px-2.5 pb-1",
                    groupIndex > 0 && "pt-3",
                  )}
                >
                  <Eyebrow className="text-zinc-600">
                    Sector {group.sector}
                  </Eyebrow>
                  <span
                    className={cn(
                      "font-mono text-2xs tabular-nums",
                      timeClass(sectorDeltasS[group.sector - 1]),
                    )}
                  >
                    {signed(sectorDeltasS[group.sector - 1])}
                  </span>
                </div>
              )}
              <ol>
                {group.tips.map(({ tip, number }) => (
                  <TipRow
                    key={tip.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(tip.id, el);
                      else rowRefs.current.delete(tip.id);
                    }}
                    tip={tip}
                    number={number}
                    largest={largest}
                    selected={tip.id === selectedTipId}
                    hovered={tip.id === hoveredTipId}
                    onSelectTip={onSelectTip}
                    onHoverTip={onHoverTip}
                  />
                ))}
              </ol>
            </section>
          ))}
        </ScrollArea>
      )}

      {tips.length > 0 && remainderCount > 0 && (
        <p className="mt-2 flex justify-between border-t border-zinc-800/80 px-2.5 pt-2 font-mono text-xs tabular-nums text-zinc-600">
          <span>
            {remainderCount} smaller stretch{remainderCount === 1 ? "" : "es"}
          </span>
          <span className={timeClass(remainderS)}>{signed(remainderS)}</span>
        </p>
      )}
    </div>
  );
}

function TipRow({
  ref,
  tip,
  number,
  largest,
  selected,
  hovered,
  onSelectTip,
  onHoverTip,
}: {
  ref: (el: HTMLLIElement | null) => void;
  tip: LapTip;
  number: number;
  largest: number;
  selected: boolean;
  hovered: boolean;
  onSelectTip: (tip: LapTip | null) => void;
  onHoverTip: (tip: LapTip | null) => void;
}) {
  // Battery deployment moves the gap without any driving to copy, so those
  // rows say so and their bar steps back.
  const notDriving = tip.category === "Battery" && tip.kind === "note";
  const Icon = CATEGORY_ICONS[tip.category];
  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={() => onSelectTip(selected ? null : tip)}
        onPointerEnter={() => onHoverTip(tip)}
        onPointerLeave={() => onHoverTip(null)}
        onFocus={() => onHoverTip(tip)}
        onBlur={() => onHoverTip(null)}
        aria-pressed={selected}
        className={cn(
          "grid w-full grid-cols-[1.25rem_minmax(0,1fr)_4.5rem] items-start gap-x-3 rounded-xl px-2.5 py-2 text-left transition-colors",
          selected
            ? "bg-zinc-800/70 ring-1 ring-inset ring-white/[0.06]"
            : hovered
              ? "bg-zinc-800/40"
              : "hover:bg-zinc-800/40",
        )}
      >
        <span className="flex size-5 items-center justify-center rounded-full font-mono text-2xs font-semibold text-zinc-400 ring-1 ring-inset ring-zinc-700">
          {number}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Icon
                className="size-3.5 shrink-0 text-zinc-500"
                aria-label={tip.category}
              >
                <title>{tip.category}</title>
              </Icon>
              <span className="text-sm font-medium text-zinc-100">
                {tip.title}
              </span>
            </span>
            {notDriving && (
              <span className="rounded-md px-1.5 text-2xs text-zinc-500 ring-1 ring-inset ring-zinc-800">
                not driving
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            {tip.summary}
          </span>
          {selected && (
            <span className="mt-2 block text-sm/relaxed text-zinc-300">
              {tip.advice && (
                <span className="font-medium text-zinc-100">
                  {tip.advice}.{" "}
                </span>
              )}
              {tip.evidence}
            </span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1.5 pt-px">
          <span
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              timeClass(tip.timeS),
            )}
          >
            {signed(tip.timeS)}
          </span>
          <span
            className="flex h-1 w-full justify-end rounded-full bg-zinc-800/80"
            aria-hidden
          >
            <span
              className={cn(
                "block h-full rounded-full",
                tipTone(tip) === "behind" ? "bg-behind" : "bg-ahead",
                notDriving ? "opacity-35" : "opacity-70",
              )}
              style={{
                width: `${Math.max(8, (Math.abs(tip.timeS) / (largest || 1)) * 100)}%`,
              }}
            />
          </span>
        </span>
      </button>
    </li>
  );
}
