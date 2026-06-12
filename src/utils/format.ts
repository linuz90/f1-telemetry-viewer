/** Convert milliseconds to lap time string (e.g. 84903 -> "1:24.903") */
export function msToLapTime(ms: number): string {
  if (ms <= 0) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3);
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, "0")}` : seconds;
}

/** Convert milliseconds to sector time string (e.g. 33341 -> "33.341") */
export function msToSectorTime(ms: number): string {
  if (ms <= 0) return "-";
  return (ms / 1000).toFixed(3);
}

/** Format wear percentage to 1 decimal place */
export function formatWear(wear: number): string {
  return `${wear.toFixed(1)}%`;
}

/** Format a date string for display */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Format time portion of a date string */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Format a date as short month + day (e.g. "Jan 30") */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

/** Check if a lap is valid based on bit flags (15 = all 4 sectors valid) */
export function isLapValid(flags: number): boolean {
  return flags === 15;
}

/** Format a gap string (e.g. "+1.234s" or "Leader") */
export function formatGap(ms: number): string {
  if (ms === 0) return "Leader";
  const sign = ms > 0 ? "+" : "-";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}

/**
 * Format session type for display (shorter labels).
 *
 * F2 weekends in PnG exports use `session-type: "Race"` for the Sprint and
 * `session-type: "Race 2"` for the Feature Race. F1 never uses "Race 2", so the
 * formula check here is the safe way to relabel without affecting F1 results.
 */
export function formatSessionType(type: string, formula?: string): string {
  if (formula && /^\s*(formula\s+)?f2\b/i.test(formula)) {
    if (type === "Race") return "Sprint";
    if (type === "Race 2") return "Feature Race";
  }
  switch (type) {
    case "One Shot Qualifying":
      return "One-Shot Quali";
    case "Short Qualifying":
      return "Short Quali";
    default:
      return type;
  }
}

/** Convert track name to a lowercase URL slug */
export function toTrackSlug(track: string): string {
  return track.toLowerCase();
}

/** Map F1 track names (from telemetry filenames) to ISO 3166-1 alpha-2 country codes */
const TRACK_COUNTRY_CODES: Record<string, string> = {
  // Current F1 calendar
  Bahrain: "bh",
  Sakhir: "bh",
  Jeddah: "sa",
  SaudiArabia: "sa",
  Australia: "au",
  Melbourne: "au",
  Japan: "jp",
  Suzuka: "jp",
  China: "cn",
  Shanghai: "cn",
  Miami: "us",
  Imola: "it",
  Monaco: "mc",
  Spain: "es",
  Barcelona: "es",
  Catalunya: "es",
  Madrid: "es",
  Madring: "es",
  Canada: "ca",
  Montreal: "ca",
  Austria: "at",
  Spielberg: "at",
  Silverstone: "gb",
  Hungary: "hu",
  Budapest: "hu",
  Hungaroring: "hu",
  Spa: "be",
  Belgium: "be",
  Zandvoort: "nl",
  Netherlands: "nl",
  Monza: "it",
  Italy: "it",
  Baku: "az",
  Azerbaijan: "az",
  Singapore: "sg",
  Marina: "sg",
  Austin: "us",
  COTA: "us",
  Texas: "us",
  Mexico: "mx",
  Brazil: "br",
  Interlagos: "br",
  SaoPaulo: "br",
  "Las Vegas": "us",
  LasVegas: "us",
  Vegas: "us",
  Qatar: "qa",
  Lusail: "qa",
  Losail: "qa",
  "Abu Dhabi": "ae",
  AbuDhabi: "ae",
  YasMarina: "ae",
  // Classic / additional circuits
  Portugal: "pt",
  Portimao: "pt",
  France: "fr",
  "Paul Ricard": "fr",
  PaulRicard: "fr",
  Russia: "ru",
  Sochi: "ru",
  Turkey: "tr",
  Istanbul: "tr",
  Vietnam: "vn",
  Hanoi: "vn",
  Hockenheim: "de",
  // Reverse / short layouts
  "Austria Reverse": "at",
  "Silverstone Reverse": "gb",
  "Zandvoort Reverse": "nl",
  "Sakhir Short": "bh",
  "Silverstone Short": "gb",
  "Texas Short": "us",
  "Suzuka Short": "jp",
};

/**
 * Calendar orders use track names as they appear in telemetry files
 * (from pits-n-giggles TrackID display names).
 */
const F1_25_TRACK_CALENDAR_ORDER: string[] = [
  "Melbourne",
  "Shanghai",
  "Suzuka",
  "Sakhir",
  "Jeddah",
  "Miami",
  "Imola",
  "Monaco",
  "Catalunya",
  "Montreal",
  "Austria",
  "Silverstone",
  "Spa",
  "Hungaroring",
  "Zandvoort",
  "Monza",
  "Baku",
  "Singapore",
  "Texas",
  "Mexico",
  "Brazil",
  "Las Vegas",
  "Losail",
  "Lusail",
  "Abu Dhabi",
];

const F1_26_TRACK_CALENDAR_ORDER: string[] = [
  "Melbourne",
  "Shanghai",
  "Suzuka",
  "Sakhir",
  "Jeddah",
  "Miami",
  "Montreal",
  "Monaco",
  "Catalunya",
  "Austria",
  "Silverstone",
  "Spa",
  "Hungaroring",
  "Zandvoort",
  "Monza",
  "Madrid",
  "Madring",
  "Baku",
  "Singapore",
  "Texas",
  "Mexico",
  "Brazil",
  "Las Vegas",
  "Losail",
  "Lusail",
  "Abu Dhabi",
];

const ADDITIONAL_TRACK_ORDER: string[] = [
  // Game/DLC/non-calendar circuits
  "Madrid",
  "Madring",
  "Imola",
  "Paul Ricard",
  "Hockenheim",
  "Sochi",
  "Portimao",
  "Hanoi",
  // Short / reverse layouts
  "Sakhir Short",
  "Silverstone Short",
  "Texas Short",
  "Suzuka Short",
  "Silverstone Reverse",
  "Austria Reverse",
  "Zandvoort Reverse",
];

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

/** Sort track names by calendar order (unknown tracks sort to the end alphabetically). */
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

/** Get ISO country code for a track name, or null for unknown tracks */
export function getTrackCountryCode(track: string): string | null {
  return TRACK_COUNTRY_CODES[track] ?? null;
}

/** Get emoji icon for a session type */
export function getSessionIcon(type: string): string {
  if (type.startsWith("Race")) return "\u{1F3C1}"; // 🏁

  switch (type) {
    case "Short Qualifying":
    case "Short Quali":
      return "\u23F1\uFE0F"; // ⏱️
    case "One Shot Qualifying":
    case "One-Shot Quali":
      return "\u{1F3AF}"; // 🎯
    case "Time Trial":
      return "\u{1F3CE}\uFE0F"; // 🏎️
    default:
      return "\u{1F3C1}"; // 🏁
  }
}
