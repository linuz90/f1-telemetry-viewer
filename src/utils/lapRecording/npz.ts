import JSZip from "jszip";
import type { LapTrace } from "./types";

const NPY_MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // "\x93NUMPY"

type NpyReader = (view: DataView, offset: number) => number;

const NPY_READERS: Record<string, { size: number; read: NpyReader }> = {
  "<f4": { size: 4, read: (v, o) => v.getFloat32(o, true) },
  "<f8": { size: 8, read: (v, o) => v.getFloat64(o, true) },
  "<i4": { size: 4, read: (v, o) => v.getInt32(o, true) },
  "<u4": { size: 4, read: (v, o) => v.getUint32(o, true) },
  "<i2": { size: 2, read: (v, o) => v.getInt16(o, true) },
  "<u2": { size: 2, read: (v, o) => v.getUint16(o, true) },
  "|i1": { size: 1, read: (v, o) => v.getInt8(o) },
  "|u1": { size: 1, read: (v, o) => v.getUint8(o) },
  "|b1": { size: 1, read: (v, o) => v.getUint8(o) },
};

/**
 * Decode one 1-D `.npy` array into Float32Array. Only the little-endian and
 * byte-sized dtypes numpy writes on PC/Mac are supported; anything else
 * (big-endian, fortran order, other shapes or header versions) is rejected
 * so a format change fails loudly instead of producing garbage traces.
 */
export function decodeNpy(bytes: Uint8Array): Float32Array {
  if (bytes.length < 10 || NPY_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("Not a .npy array");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6];
  if (major < 1 || major > 3)
    throw new Error(`Unsupported .npy version ${major}`);
  const headerLength =
    major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerStart = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(
    bytes.subarray(headerStart, headerStart + headerLength),
  );
  const descr = header.match(/'descr':\s*'([^']+)'/)?.[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shape = header.match(/'shape':\s*\(([^)]*)\)/)?.[1];
  const dims = (shape ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  const reader = descr ? NPY_READERS[descr] : undefined;
  const length = dims.length === 1 ? dims[0] : NaN;
  if (!reader || fortran || !Number.isSafeInteger(length) || length < 0) {
    throw new Error(`Unsupported .npy array (${descr ?? "unknown"} ${shape})`);
  }

  const dataStart = headerStart + headerLength;
  if (dataStart + length * reader.size > bytes.length) {
    throw new Error("Truncated .npy array");
  }
  if (descr === "<f4") {
    // Copy so the result owns an aligned buffer regardless of the zip offset.
    return new Float32Array(
      bytes.slice(dataStart, dataStart + length * 4).buffer,
    );
  }
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = reader.read(view, dataStart + i * reader.size);
  }
  return out;
}

/** Decode every array in one lap's `.npz`, or only the requested channels. */
export async function decodeLapNpz(
  bytes: Uint8Array,
  channels?: readonly string[],
): Promise<LapTrace> {
  const zip = await JSZip.loadAsync(bytes);
  const trace: Record<string, Float32Array> = {};
  const wanted = channels ? new Set(channels) : undefined;
  const entries: [string, JSZip.JSZipObject][] = [];
  zip.forEach((path, entry) => {
    if (entry.dir || !path.endsWith(".npy")) return;
    const channel = path.slice(0, -4);
    if (!wanted || wanted.has(channel)) entries.push([channel, entry]);
  });
  await Promise.all(
    entries.map(async ([channel, entry]) => {
      trace[channel] = decodeNpy(await entry.async("uint8array"));
    }),
  );
  return trace;
}
