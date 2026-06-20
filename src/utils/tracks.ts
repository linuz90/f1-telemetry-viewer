import {
  ADDITIONAL_TRACK_ORDER,
  F1_25_TRACK_CALENDAR_ORDER,
  F1_26_TRACK_CALENDAR_ORDER,
  TRACK_COUNTRY_CODES,
} from "../constants/tracks";

/** Convert track names like "Abu Dhabi" to stable path slugs like "abu-dhabi". */
export function toTrackSlug(track: string): string {
  return track
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isTrackSlugMatch(
  track: string,
  slug: string | undefined,
): boolean {
  return toTrackSlug(track) === (slug ?? "").toLowerCase();
}

function getTrackCalendarOrder(formulaScopeKey?: string | null): string[] {
  // F1 26 has a different real-world calendar than F1 25: Imola drops out
  // and Madrid/Madring sits between Monza and Baku. Keep the older order as
  // the fallback so legacy F1/F2 exports remain stable.
  const officialOrder =
    formulaScopeKey === "f1-26"
      ? F1_26_TRACK_CALENDAR_ORDER
      : F1_25_TRACK_CALENDAR_ORDER;

  const officialTracks = new Set(officialOrder);
  return [
    ...officialOrder,
    ...ADDITIONAL_TRACK_ORDER.filter((track) => !officialTracks.has(track)),
  ];
}

/** Sort track names by calendar order; unknown tracks sort to the end alphabetically. */
export function sortTracksByCalendar(
  tracks: string[],
  formulaScopeKey?: string | null,
): string[] {
  const trackCalendarOrder = getTrackCalendarOrder(formulaScopeKey);
  return [...tracks].sort((a, b) => {
    const idxA = trackCalendarOrder.indexOf(a);
    const idxB = trackCalendarOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Get ISO country code for a track name, or null for unknown tracks. */
export function getTrackCountryCode(track: string): string | null {
  return TRACK_COUNTRY_CODES[track] ?? null;
}
