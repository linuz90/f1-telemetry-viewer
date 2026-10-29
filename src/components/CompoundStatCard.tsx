import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import { getCompoundColor } from "../utils/colors";
import { dynamicAccentCardStyle } from "./Card";
import { Tooltip } from "./Tooltip";
import { HStack } from "./ui/Stack";
import { tableRowClass } from "./ui/table";

export interface CompoundStatCardRow {
  label: string;
  /** Muted evidence suffix after the label (e.g. "33 laps"); wraps as a unit
   *  on narrow cards instead of splitting mid-phrase. */
  note?: string;
  /** Hover explanation of how the value is calculated */
  tooltip?: string;
  value: string;
  comparisonValue?: string;
  className?: string;
  comparisonClassName?: string;
  /** Insert a subtle divider line before this row */
  divider?: boolean;
}

interface CompoundStatCardHero {
  value: string;
  label: string;
  comparisonValue?: string;
}

interface CompoundStatCardProps {
  compound: string;
  /** Subtitle shown next to compound name (e.g. "10 laps") */
  subtitle?: string;
  rows: CompoundStatCardRow[];
  /** Large hero number displayed prominently above the rows */
  hero?: CompoundStatCardHero;
  /** Rendered between the hero and the rows (evidence bars, captions) */
  belowHero?: ReactNode;
  valueLabel?: string;
  comparisonLabel?: string;
  className?: string;
  children?: ReactNode;
}

export function CompoundStatCard({
  compound,
  subtitle,
  rows,
  hero,
  belowHero,
  valueLabel = "Main",
  comparisonLabel,
  className,
  children,
}: CompoundStatCardProps) {
  const color = getCompoundColor(compound);
  const hasComparison = Boolean(
    comparisonLabel &&
    (hero?.comparisonValue != null ||
      rows.some((row) => row.comparisonValue != null)),
  );

  // Shared accent-tile recipe (see Card.tsx) — compound color drives a linear
  // top-left → bottom-right gradient and a 1px inset accent ring. Mirrors the
  // static-color accents (podium chips, insight cards, best-lap highlights).
  return (
    <div
      className={cn("rounded-xl px-3 py-3", className)}
      style={dynamicAccentCardStyle(color)}
    >
      <HStack className="mb-1.5 gap-1.5">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-medium text-tone-300 truncate">
          {compound}
        </span>
        {subtitle && (
          <span className="ml-auto font-mono text-2xs tabular-nums text-tone-500">
            {subtitle}
          </span>
        )}
      </HStack>
      {hero && !hasComparison && (
        <div className="text-center py-2 mb-1.5">
          <div className="font-mono text-2xl font-medium text-tone-100">
            {hero.value}
          </div>
          <div className="mt-0.5 font-mono text-xs tabular-nums text-tone-500">
            {hero.label}
          </div>
        </div>
      )}
      {hero && hasComparison && (
        <div className="py-2 mb-1.5">
          <div className="mb-1 text-center font-mono text-xs tabular-nums text-tone-500">
            {hero.label}
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="min-w-0">
              <div className="truncate font-mono text-xl font-medium text-tone-100">
                {hero.value}
              </div>
              <div
                className="mt-0.5 truncate text-2xs text-tone-500"
                title={valueLabel}
              >
                {valueLabel}
              </div>
            </div>
            <div className="min-w-0">
              <div className="truncate font-mono text-xl font-medium text-tone-400">
                {hero.comparisonValue ?? "–"}
              </div>
              <div
                className="mt-0.5 truncate text-2xs text-tone-500"
                title={comparisonLabel}
              >
                {comparisonLabel}
              </div>
            </div>
          </div>
        </div>
      )}
      {belowHero && <div className="mb-2">{belowHero}</div>}
      <div className="text-xs text-tone-400 space-y-1.5">
        {hasComparison && (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(4.75rem,5.75rem)_minmax(4.75rem,5.75rem)] items-baseline gap-2 text-2xs text-tone-600">
            <span />
            <span className="truncate text-right" title={valueLabel}>
              {valueLabel}
            </span>
            <span className="truncate text-right" title={comparisonLabel}>
              {comparisonLabel}
            </span>
          </div>
        )}
        {rows.map((row, i) => (
          <div key={i}>
            {row.divider && <div className={cn(tableRowClass, "my-2")} />}
            {hasComparison ? (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(4.75rem,5.75rem)_minmax(4.75rem,5.75rem)] items-baseline gap-2">
                <span className="min-w-0 truncate">
                  {row.label}
                  {row.note && (
                    <span className="text-tone-600"> · {row.note}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "truncate text-right tabular-nums",
                    row.className ?? "font-mono text-tone-300",
                  )}
                >
                  {row.value}
                </span>
                <span
                  className={cn(
                    "truncate text-right font-mono tabular-nums text-tone-500",
                    row.comparisonClassName,
                  )}
                >
                  {row.comparisonValue ?? "–"}
                </span>
              </div>
            ) : (
              <HStack justify="between">
                {row.tooltip ? (
                  <Tooltip text={row.tooltip}>
                    <span className="cursor-help">
                      {row.label}
                      {row.note && (
                        <>
                          {" "}
                          <span className="whitespace-nowrap text-tone-600">
                            · {row.note}
                          </span>
                        </>
                      )}
                    </span>
                  </Tooltip>
                ) : (
                  <span>
                    {row.label}
                    {row.note && (
                      <>
                        {" "}
                        <span className="whitespace-nowrap text-tone-600">
                          · {row.note}
                        </span>
                      </>
                    )}
                  </span>
                )}
                <span
                  className={cn(
                    "whitespace-nowrap",
                    row.className ?? "text-tone-300 font-mono",
                  )}
                >
                  {row.value}
                </span>
              </HStack>
            )}
          </div>
        ))}
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}
