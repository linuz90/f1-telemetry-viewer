/**
 * Pits n' Giggles segments whose turn numbers differ from the official
 * numbering that `getTrackCorners()` and the lap tips use. Up to 5.0.0-beta.1
 * it numbered Melbourne by the pre-2022 layout and used Montreal's Turn 5
 * twice; fixed upstream in https://github.com/ashwin-nat/pits-n-giggles/pull/343.
 *
 * Ranges are its segments in game lap metres, start inclusive and end
 * exclusive like its own lookup. `turns: null` marks a segment that is no
 * longer a corner, which the corrected files drop. Exports made with either
 * version therefore read the same after `normalizeSession()` applies these.
 */
export interface PngTurnFix {
  fromM: number;
  toM: number;
  turns: readonly number[] | null;
}

export const PNG_TURN_FIXES: Record<
  string,
  { trackLengthM: number; fixes: readonly PngTurnFix[] }
> = {
  melbourne: {
    trackLengthM: 5276,
    fixes: [
      // The old Turn 9/10 chicane ("Clark"), flat out since 2022.
      { fromM: 2350, toM: 2600, turns: null },
      { fromM: 2700, toM: 3130, turns: null },
      { fromM: 3175, toM: 3365, turns: [9] },
      { fromM: 3366, toM: 3600, turns: [10] },
      { fromM: 4000, toM: 4230, turns: [11] },
      { fromM: 4300, toM: 4530, turns: [12] },
      { fromM: 4550, toM: 4720, turns: [13] },
      { fromM: 4721, toM: 4900, turns: [14] },
    ],
  },
  montreal: {
    trackLengthM: 4371,
    fixes: [
      { fromM: 1175, toM: 1290, turns: [6] },
      { fromM: 1290, toM: 1570, turns: [7] },
      { fromM: 3850, toM: 4070, turns: [13, 14] },
    ],
  },
};
