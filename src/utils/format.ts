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

/** Format session type for display (shorter labels) */
export function formatSessionType(type: string): string {
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

/** Map F1 track names (from telemetry filenames) to country flag emoji */
const TRACK_FLAGS: Record<string, string> = {
  // Current F1 calendar
  Bahrain: "\u{1F1E7}\u{1F1ED}",       // 🇧🇭
  Jeddah: "\u{1F1F8}\u{1F1E6}",        // 🇸🇦
  SaudiArabia: "\u{1F1F8}\u{1F1E6}",   // 🇸🇦
  Australia: "\u{1F1E6}\u{1F1FA}",      // 🇦🇺
  Melbourne: "\u{1F1E6}\u{1F1FA}",      // 🇦🇺
  Japan: "\u{1F1EF}\u{1F1F5}",          // 🇯🇵
  Suzuka: "\u{1F1EF}\u{1F1F5}",         // 🇯🇵
  China: "\u{1F1E8}\u{1F1F3}",          // 🇨🇳
  Shanghai: "\u{1F1E8}\u{1F1F3}",       // 🇨🇳
  Miami: "\u{1F1FA}\u{1F1F8}",          // 🇺🇸
  Imola: "\u{1F1EE}\u{1F1F9}",          // 🇮🇹
  Monaco: "\u{1F1F2}\u{1F1E8}",         // 🇲🇨
  Spain: "\u{1F1EA}\u{1F1F8}",          // 🇪🇸
  Barcelona: "\u{1F1EA}\u{1F1F8}",      // 🇪🇸
  Canada: "\u{1F1E8}\u{1F1E6}",         // 🇨🇦
  Montreal: "\u{1F1E8}\u{1F1E6}",       // 🇨🇦
  Austria: "\u{1F1E6}\u{1F1F9}",        // 🇦🇹
  Spielberg: "\u{1F1E6}\u{1F1F9}",      // 🇦🇹
  Silverstone: "\u{1F1EC}\u{1F1E7}",    // 🇬🇧
  Hungary: "\u{1F1ED}\u{1F1FA}",        // 🇭🇺
  Budapest: "\u{1F1ED}\u{1F1FA}",       // 🇭🇺
  Hungaroring: "\u{1F1ED}\u{1F1FA}",    // 🇭🇺
  Spa: "\u{1F1E7}\u{1F1EA}",            // 🇧🇪
  Belgium: "\u{1F1E7}\u{1F1EA}",        // 🇧🇪
  Zandvoort: "\u{1F1F3}\u{1F1F1}",      // 🇳🇱
  Netherlands: "\u{1F1F3}\u{1F1F1}",    // 🇳🇱
  Monza: "\u{1F1EE}\u{1F1F9}",          // 🇮🇹
  Italy: "\u{1F1EE}\u{1F1F9}",          // 🇮🇹
  Baku: "\u{1F1E6}\u{1F1FF}",           // 🇦🇿
  Azerbaijan: "\u{1F1E6}\u{1F1FF}",     // 🇦🇿
  Singapore: "\u{1F1F8}\u{1F1EC}",      // 🇸🇬
  Marina: "\u{1F1F8}\u{1F1EC}",         // 🇸🇬
  Austin: "\u{1F1FA}\u{1F1F8}",         // 🇺🇸
  COTA: "\u{1F1FA}\u{1F1F8}",           // 🇺🇸
  Texas: "\u{1F1FA}\u{1F1F8}",          // 🇺🇸
  Mexico: "\u{1F1F2}\u{1F1FD}",         // 🇲🇽
  Brazil: "\u{1F1E7}\u{1F1F7}",         // 🇧🇷
  Interlagos: "\u{1F1E7}\u{1F1F7}",     // 🇧🇷
  SaoPaulo: "\u{1F1E7}\u{1F1F7}",       // 🇧🇷
  LasVegas: "\u{1F1FA}\u{1F1F8}",       // 🇺🇸
  Vegas: "\u{1F1FA}\u{1F1F8}",          // 🇺🇸
  Qatar: "\u{1F1F6}\u{1F1E6}",          // 🇶🇦
  Lusail: "\u{1F1F6}\u{1F1E6}",         // 🇶🇦
  Losail: "\u{1F1F6}\u{1F1E6}",         // 🇶🇦
  AbuDhabi: "\u{1F1E6}\u{1F1EA}",       // 🇦🇪
  YasMarina: "\u{1F1E6}\u{1F1EA}",      // 🇦🇪
  // Classic / additional circuits
  Portugal: "\u{1F1F5}\u{1F1F9}",        // 🇵🇹
  Portimao: "\u{1F1F5}\u{1F1F9}",        // 🇵🇹
  France: "\u{1F1EB}\u{1F1F7}",          // 🇫🇷
  PaulRicard: "\u{1F1EB}\u{1F1F7}",      // 🇫🇷
  Russia: "\u{1F1F7}\u{1F1FA}",          // 🇷🇺
  Sochi: "\u{1F1F7}\u{1F1FA}",           // 🇷🇺
  Turkey: "\u{1F1F9}\u{1F1F7}",          // 🇹🇷
  Istanbul: "\u{1F1F9}\u{1F1F7}",        // 🇹🇷
  Vietnam: "\u{1F1FB}\u{1F1F3}",         // 🇻🇳
  Hanoi: "\u{1F1FB}\u{1F1F3}",           // 🇻🇳
};

/**
 * F1 2025 calendar order, using track names as they appear in telemetry
 * files (from pits-n-giggles TrackID display names).
 * Tracks not in this list sort to the end alphabetically.
 */
const TRACK_CALENDAR_ORDER: string[] = [
  // 2025 F1 calendar
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
  // Legacy / additional circuits
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

/** Sort track names by F1 calendar order (unknown tracks sort to the end alphabetically) */
export function sortTracksByCalendar(tracks: string[]): string[] {
  return [...tracks].sort((a, b) => {
    const idxA = TRACK_CALENDAR_ORDER.indexOf(a);
    const idxB = TRACK_CALENDAR_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}

/** Get country flag emoji for a track name */
export function getTrackFlag(track: string): string {
  return TRACK_FLAGS[track] ?? "\u{1F3CE}\u{FE0F}"; // 🏎️ fallback
}

/** Get emoji icon for a session type */
export function getSessionIcon(type: string): string {
  switch (type) {
    case "Race":
      return "\u{1F3C1}"; // 🏁
    case "Short Qualifying":
    case "Short Quali":
      return "\u23F1\uFE0F"; // ⏱️
    case "One Shot Qualifying":
    case "One-Shot Quali":
      return "\u{1F3AF}"; // 🎯
    default:
      return "\u{1F3C1}"; // 🏁
  }
}
