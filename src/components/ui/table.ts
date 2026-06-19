import { cn } from "../../utils/cn";

/** Shared row divider for data tables — matches the inset highlight on cards. */
export const tableRowClass = "border-t border-white/[0.04]";

/**
 * Shared <thead> styling for data tables. `text-zinc-500` is the muted header
 * tone; the `[&_th]:font-normal` descendant selector pins each cell's weight
 * directly (Geist sans at 400 still reads heavier than the mono data rows, so
 * inheriting via thead alone isn't enough — apply the rule on the th itself).
 */
export const tableHeadClass = "text-zinc-500 [&_th]:font-normal";

export const tableClass = "w-full text-xs";
export const tableClassLoose = "w-full text-sm";

type TableCellAlign = "left" | "right" | "center";
type TableCellSize = "sm" | "md";

const CELL_ALIGN: Record<TableCellAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

const CELL_SIZE: Record<TableCellSize, string> = {
  sm: "py-1 px-2",
  md: "py-1.5 px-2",
};

export function tableCellClass({
  align = "left",
  mono = false,
  size = "md",
  className,
}: {
  align?: TableCellAlign;
  mono?: boolean;
  size?: TableCellSize;
  className?: string;
} = {}) {
  return cn(CELL_ALIGN[align], CELL_SIZE[size], mono && "font-mono", className);
}

export function tableHeadCellClass({
  align = "left",
  size = "md",
  sortable = false,
  className,
}: {
  align?: TableCellAlign;
  size?: TableCellSize;
  sortable?: boolean;
  className?: string;
} = {}) {
  return tableCellClass({
    align,
    size,
    className: cn(sortable && "cursor-pointer select-none group", className),
  });
}
