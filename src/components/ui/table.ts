import { cva } from "class-variance-authority";
import { cn } from "../../utils/cn";

/**
 * Data tables: every <table> in the app takes its classes from here.
 *
 * Cells come in three layouts. `inset` pads both sides so a row background
 * (the focused driver) has room around its text. `flush` drops the leading pad
 * so the first column lines up with the card title, for tables whose rows
 * never carry a background. `edge` is for a table that fills an unpadded card
 * edge to edge, so its hover rows reach the card's sides.
 */
export const tableClass = "w-full text-sm";

/** Wide tables with many columns (race classification) trade size for density. */
export const tableClassDense = "w-full text-xs";

/**
 * On <thead>. `[&_th]:font-normal` pins the weight on each th: Geist at 400
 * still reads heavier than the mono data rows, so inheriting from thead alone
 * isn't enough.
 */
export const tableHeadClass =
  "text-left text-xs text-tone-500 [&_th]:font-normal";

/** On each body <tr>. */
export const tableRowClass = "border-t border-tone-800/70";

/** Added to the current driver's row, tinted with `active`, the current-driver
 *  token. Only `inset` cells leave room for it. */
export const tableRowFocusedClass = "bg-active/10 font-medium text-tone-0";

type TableCellAlign = "left" | "right" | "center";
type TableCellSize = "sm" | "md";
type TableCellLayout = "inset" | "flush" | "edge";

const cellVariants = cva("", {
  variants: {
    align: { left: "text-left", right: "text-right", center: "text-center" },
    mono: { true: "font-mono" },
    size: { sm: "", md: "" },
    layout: { inset: "", flush: "", edge: "" },
    sortable: { true: "group cursor-pointer select-none" },
  },
  compoundVariants: [
    { layout: "inset", size: "sm", class: "px-2 py-1" },
    { layout: "inset", size: "md", class: "px-2 py-1.5" },
    { layout: "flush", size: "sm", class: "py-1.5 pr-3 last:pr-0" },
    { layout: "flush", size: "md", class: "py-2 pr-3 last:pr-0" },
    { layout: "edge", size: "sm", class: "px-4 py-2" },
    { layout: "edge", size: "md", class: "px-4 py-2.5" },
  ],
  defaultVariants: { align: "left", size: "md", layout: "inset" },
});

interface TableCellOptions {
  align?: TableCellAlign;
  size?: TableCellSize;
  layout?: TableCellLayout;
  className?: string;
}

export function tableCellClass({
  align = "left",
  mono = false,
  size = "md",
  layout = "inset",
  className,
}: TableCellOptions & { mono?: boolean } = {}) {
  return cn(cellVariants({ align, layout, size, mono }), className);
}

export function tableHeadCellClass({
  sortable = false,
  className,
  ...cell
}: TableCellOptions & { sortable?: boolean } = {}) {
  return cn(cellVariants({ ...cell, sortable }), className);
}
