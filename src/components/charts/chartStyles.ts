import { floatingSurface } from "../ui/surfaces";

/** Hover readout on every chart. Recharts charts render it through a custom
 *  tooltip `content`, since the built-in one takes only inline styles. */
export const chartTooltipClass = `pointer-events-none rounded-lg px-2.5 py-1.5 text-xs ${floatingSurface}`;

/** Axis tick labels on the hand-drawn SVG charts. Recharts axes take
 *  `CHART_THEME.axis` and `fontSize={11}` as props instead. */
export const chartTickClass = "fill-tone-500 text-[10.5px] tabular-nums";
