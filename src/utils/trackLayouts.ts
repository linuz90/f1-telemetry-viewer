// Minimal track-layout SVGs sourced from julesr0y/f1-circuits-svg (CC BY 4.0).
// SVGs were sanitized at download time to use stroke:currentColor so they
// inherit the consumer's text color.

const LAYOUTS = import.meta.glob("../assets/tracks/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const lookup: Record<string, string> = Object.fromEntries(
  Object.entries(LAYOUTS).map(([path, svg]) => {
    const name = path.split("/").pop()!.replace(/\.svg$/, "");
    return [name, svg];
  }),
);

// Maps track display names (from telemetry filenames / session-info) to the
// canonical layout slug used as the SVG file name.
const TRACK_LAYOUT_KEYS: Record<string, string> = {
  Bahrain: "bahrain",
  Sakhir: "bahrain",
  Jeddah: "jeddah",
  SaudiArabia: "jeddah",
  Australia: "melbourne",
  Melbourne: "melbourne",
  Japan: "suzuka",
  Suzuka: "suzuka",
  China: "shanghai",
  Shanghai: "shanghai",
  Miami: "miami",
  Imola: "imola",
  Monaco: "monaco",
  Spain: "catalunya",
  Barcelona: "catalunya",
  Catalunya: "catalunya",
  Madrid: "madring",
  Madring: "madring",
  Canada: "montreal",
  Montreal: "montreal",
  Austria: "spielberg",
  Spielberg: "spielberg",
  Silverstone: "silverstone",
  Hungary: "hungaroring",
  Budapest: "hungaroring",
  Hungaroring: "hungaroring",
  Spa: "spa",
  Belgium: "spa",
  Zandvoort: "zandvoort",
  Netherlands: "zandvoort",
  Monza: "monza",
  Italy: "monza",
  Baku: "baku",
  Azerbaijan: "baku",
  Singapore: "marina-bay",
  Marina: "marina-bay",
  Austin: "austin",
  COTA: "austin",
  Texas: "austin",
  Mexico: "mexico-city",
  Brazil: "interlagos",
  Interlagos: "interlagos",
  SaoPaulo: "interlagos",
  "Las Vegas": "las-vegas",
  LasVegas: "las-vegas",
  Vegas: "las-vegas",
  Qatar: "lusail",
  Lusail: "lusail",
  Losail: "lusail",
  "Abu Dhabi": "yas-marina",
  AbuDhabi: "yas-marina",
  YasMarina: "yas-marina",
  Portugal: "portimao",
  Portimao: "portimao",
  France: "paul-ricard",
  "Paul Ricard": "paul-ricard",
  PaulRicard: "paul-ricard",
  Russia: "sochi",
  Sochi: "sochi",
  Turkey: "istanbul",
  Istanbul: "istanbul",
  Hockenheim: "hockenheimring",
};

/** Returns the raw SVG markup for a track, or null when unmapped. */
export function getTrackLayoutSvg(track: string): string | null {
  // Strip suffixes like "Reverse" / "Short" — they reuse the base layout.
  const base = track.replace(/\s+(Reverse|Short)$/i, "").trim();
  const key = TRACK_LAYOUT_KEYS[base] ?? TRACK_LAYOUT_KEYS[track];
  if (!key) return null;
  return lookup[key] ?? null;
}
