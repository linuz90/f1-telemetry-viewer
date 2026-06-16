/** Shared row divider for data tables — matches the inset highlight on cards. */
export const tableRowClass = "border-t border-white/[0.04]";

/**
 * Shared <thead> styling for data tables. `text-zinc-500` is the muted header
 * tone; the `[&_th]:font-normal` descendant selector pins each cell's weight
 * directly (Geist sans at 400 still reads heavier than the mono data rows, so
 * inheriting via thead alone isn't enough — apply the rule on the th itself).
 */
export const tableHeadClass = "text-zinc-500 [&_th]:font-normal";
