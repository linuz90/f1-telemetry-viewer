import JSZip from "jszip";

/** Build a 1-D little-endian float32 `.npy` the way numpy writes it. */
export function encodeNpy(values: ArrayLike<number>): Uint8Array {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${values.length},), }`;
  // numpy pads the header so the data starts on a 64-byte boundary.
  const unpadded = 10 + header.length + 1;
  header =
    header.padEnd(header.length + ((64 - (unpadded % 64)) % 64), " ") + "\n";
  const bytes = new Uint8Array(10 + header.length + values.length * 4);
  bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  new DataView(bytes.buffer).setUint16(8, header.length, true);
  bytes.set(new TextEncoder().encode(header), 10);
  const view = new DataView(bytes.buffer, 10 + header.length);
  for (let i = 0; i < values.length; i += 1)
    view.setFloat32(i * 4, values[i], true);
  return bytes;
}

export type FixtureChannels = Record<string, ArrayLike<number>>;

export async function encodeLapNpz(
  channels: FixtureChannels,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, values] of Object.entries(channels)) {
    zip.file(`${name}.npy`, encodeNpy(values), { compression: "DEFLATE" });
  }
  return zip.generateAsync({ type: "uint8array" });
}

export interface FixtureLap {
  lapNumber: number;
  lapTimeMs: number | null;
  valid?: boolean | number;
  isGood?: boolean;
  channels: FixtureChannels;
}

export interface FixtureDriver {
  index: number;
  name: string;
  team?: string;
  laps: FixtureLap[];
}

/** A `.pngt` laid out like Pits n' Giggles 5.0.0-beta.1 writes it. */
export async function buildPngt(options: {
  sessionType?: string;
  track?: string;
  version?: number;
  sessionUid?: string;
  drivers: FixtureDriver[];
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "header.json",
    JSON.stringify({ format: "pngt", version: options.version ?? 1 }),
  );
  // Written by hand so the 64-bit UID stays an unquoted integer, as exported.
  zip.file(
    "session.json",
    `{"session_uid": ${options.sessionUid ?? "6148745969696205249"}, "session_type": ${JSON.stringify(options.sessionType ?? "Short Qualifying")}, "app_version": "5.0.0-beta.1", "game_year": 25, "formula": "F1 26", "track": {"id": 0, "name": ${JSON.stringify(options.track ?? "Melbourne")}}}`,
  );
  zip.file("manifest.json", JSON.stringify({ sensors: {} }));
  zip.file(
    "drivers.json",
    JSON.stringify({
      drivers: options.drivers.map((driver) => ({
        driver_index: driver.index,
        name: driver.name,
        team: driver.team ?? "Mercedes '26",
        car_number: 63,
        is_telemetry_public: true,
      })),
    }),
  );
  for (const driver of options.drivers) {
    const folder = String(driver.index).padStart(2, "0");
    zip.file(
      `drivers/${folder}/laps.json`,
      JSON.stringify({
        laps: driver.laps.map((lap) => ({
          lap_number: lap.lapNumber,
          lap_time_ms: lap.lapTimeMs,
          valid: lap.valid ?? 1,
          tyre_compound: "Soft",
          tyre_laps: 69,
          pit_in_lap: false,
          pit_out_lap: false,
          num_points: lap.channels.lap_distance?.length ?? 0,
          is_good: lap.isGood ?? true,
        })),
      }),
    );
    for (const lap of driver.laps) {
      // The exporter stores each lap's .npz uncompressed in the outer zip.
      zip.file(
        `drivers/${folder}/lap_${String(lap.lapNumber).padStart(3, "0")}.npz`,
        await encodeLapNpz(lap.channels),
        { compression: "STORE" },
      );
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
