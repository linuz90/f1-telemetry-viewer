/** Display order for tyre compounds: softest dry first, then wets. Unknown
 *  compounds sort last in their original order. */
const COMPOUND_DISPLAY_ORDER = [
  "Soft",
  "Medium",
  "Hard",
  "Inters",
  "Intermediate",
  "Wet",
  "Wets",
];

export function compoundDisplayRank(compound: string): number {
  const index = COMPOUND_DISPLAY_ORDER.indexOf(compound);
  return index === -1 ? COMPOUND_DISPLAY_ORDER.length : index;
}
