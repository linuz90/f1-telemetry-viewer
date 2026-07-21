import {
  ADDITIONAL_TRACK_IDS,
  F1_25_TRACK_CALENDAR_IDS,
  F1_26_TRACK_CALENDAR_IDS,
  TRACK_DEFINITIONS,
  type TrackDefinition,
} from "../constants/tracks";

type TrackLayoutVariant = "short" | "reverse";

interface ResolvedTrack {
  definition: TrackDefinition | null;
  baseName: string;
  variant: TrackLayoutVariant | null;
}

function normalizeTrackLookup(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function legacySlugify(value: string): string {
  // Routes created before canonical track ids removed accented characters
  // instead of transliterating them. Register those old tokens so bookmarks
  // can resolve once and redirect to the canonical circuit URL.
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const trackDefinitionByAlias = new Map<string, TrackDefinition>();
for (const definition of TRACK_DEFINITIONS) {
  for (const alias of [
    definition.id,
    definition.displayName,
    definition.location,
    ...definition.aliases,
  ]) {
    const keys = new Set([
      normalizeTrackLookup(alias),
      normalizeTrackLookup(legacySlugify(alias)),
    ]);
    for (const key of keys) {
      const existing = trackDefinitionByAlias.get(key);
      if (existing && existing.id !== definition.id) {
        throw new Error(
          `Track alias "${alias}" is shared by ${existing.id} and ${definition.id}`,
        );
      }
      trackDefinitionByAlias.set(key, definition);
    }
  }
}

function resolveTrack(track: string): ResolvedTrack {
  const trimmed = track.trim();
  const variantMatch = trimmed.match(/(?:[\s_-]+)(short|reverse)$/i);
  const variant = (variantMatch?.[1]?.toLowerCase() ??
    null) as TrackLayoutVariant | null;
  const baseName = variantMatch
    ? trimmed.slice(0, variantMatch.index).trim()
    : trimmed;

  return {
    definition:
      trackDefinitionByAlias.get(normalizeTrackLookup(baseName)) ?? null,
    baseName,
    variant,
  };
}

/** Resolve exporter aliases to one stable circuit-and-layout identity. */
export function getTrackId(track: string): string {
  const { definition, baseName, variant } = resolveTrack(track);
  const baseId = definition?.id ?? slugify(baseName);
  return variant && baseId ? `${baseId}-${variant}` : baseId;
}

/** Return the curated compact circuit name used in product UI. */
export function getTrackDisplayName(track: string): string {
  const { definition, baseName, variant } = resolveTrack(track);
  const displayName = definition?.displayName ?? baseName;
  if (!variant) return displayName;
  const variantLabel = variant === "short" ? "Short" : "Reverse";
  return `${displayName} · ${variantLabel}`;
}

/** Convert any known track alias to its canonical route slug. */
export function toTrackSlug(track: string): string {
  return getTrackId(track);
}

const englishRegionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Get the English country name for a track, or null for unknown tracks. */
export function getTrackCountryName(track: string): string | null {
  const code = getTrackCountryCode(track);
  return code ? (englishRegionNames.of(code.toUpperCase()) ?? null) : null;
}

/** Get ISO country code for a track name, or null for unknown tracks. */
export function getTrackCountryCode(track: string): string | null {
  return resolveTrack(track).definition?.countryCode ?? null;
}

/** Get the SVG layout key for a track, reusing the base layout for variants. */
export function getTrackLayoutKey(track: string): string | null {
  return resolveTrack(track).definition?.layoutKey ?? null;
}

export function isSameTrack(a: string, b: string): boolean {
  const aId = getTrackId(a);
  return aId !== "" && aId === getTrackId(b);
}

export function isTrackSlugMatch(
  track: string,
  slug: string | undefined,
): boolean {
  return Boolean(slug) && isSameTrack(track, slug ?? "");
}

function getTrackCalendarOrder(formulaScopeKey?: string | null): string[] {
  // Calendar order is keyed by stable circuit ids rather than exporter labels,
  // so an alias change cannot move a track or create a duplicate calendar slot.
  const officialOrder =
    formulaScopeKey === "f1-26"
      ? F1_26_TRACK_CALENDAR_IDS
      : F1_25_TRACK_CALENDAR_IDS;

  const officialTracks = new Set<string>(officialOrder);
  return [
    ...officialOrder,
    ...ADDITIONAL_TRACK_IDS.filter((id) => !officialTracks.has(id)),
  ];
}

/** Sort track names or ids by calendar order; unknown tracks sort alphabetically. */
export function sortTracksByCalendar(
  tracks: string[],
  formulaScopeKey?: string | null,
): string[] {
  const trackCalendarOrder = getTrackCalendarOrder(formulaScopeKey);
  const orderById = new Map(
    trackCalendarOrder.map((trackId, index) => [trackId, index]),
  );

  return [...tracks].sort((a, b) => {
    const idxA = orderById.get(getTrackId(a));
    const idxB = orderById.get(getTrackId(b));
    if (idxA != null && idxB != null) return idxA - idxB;
    if (idxA != null) return -1;
    if (idxB != null) return 1;
    return getTrackDisplayName(a).localeCompare(getTrackDisplayName(b));
  });
}
