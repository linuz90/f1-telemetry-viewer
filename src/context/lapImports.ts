import {
  LAP_IMPORTS_DB_NAME,
  LAP_IMPORTS_STORE_NAME,
} from "../constants/storage";
import {
  openLapRecording,
  type OpenedLapRecording,
} from "../utils/lapRecording/reader";
import type { LapRecordingManifest } from "../utils/lapRecording/types";

/**
 * Lap recordings imported into this browser, typically a `.pngt` a friend
 * shared. They persist in IndexedDB, beside and never inside the telemetry
 * folder, so they work in every data mode (the viewer embedded in Pits n'
 * Giggles included) and never mix into the user's own files.
 */

export const IMPORTED_SLUG_PREFIX = "imported-";

export function isImportedSlug(slug: string): boolean {
  return slug.startsWith(IMPORTED_SLUG_PREFIX);
}

/** Whose laps an import holds: a recording has no player marker of its own. */
export interface LapImportOwner {
  /** The car its owner drove. */
  driverIndex: number;
  /** Shown in place of that driver's name; null when the file is the user's own. */
  name: string | null;
}

export interface StoredLapImport {
  slug: string;
  fileName: string;
  data: Blob;
  owner: LapImportOwner | null;
  importedAt: string;
}

export interface LapImport extends StoredLapImport {
  /** As read from the file, before `applyImportOwner()`. */
  raw: LapRecordingManifest;
  /** What the viewer serves: the owner-applied manifest and the lap bytes. */
  recording: OpenedLapRecording;
}

/**
 * The manifest the viewer serves for an import. A shared file's player is
 * its owner, never the person viewing it, so only an import the user marks
 * as their own gets a player; a friend's car takes the friend's name.
 */
export function applyImportOwner(
  raw: LapRecordingManifest,
  slug: string,
  owner: LapImportOwner | null,
): LapRecordingManifest {
  const friendName =
    owner && owner.name !== null ? owner.name.trim() || "Friend" : null;
  return {
    ...raw,
    slug,
    sessionSlug: undefined,
    playerIndex: owner && owner.name === null ? owner.driverIndex : undefined,
    imported: true,
    drivers: raw.drivers.map((driver) =>
      friendName && driver.index === owner?.driverIndex
        ? { ...driver, name: friendName }
        : driver,
    ),
  };
}

/**
 * FNV-1a over the file. Two friends in one online lobby send files with the
 * same name, so the slug needs the content too; `crypto.subtle` is missing
 * outside secure contexts, e.g. the embedded viewer opened over the LAN.
 */
function contentHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Lap refs in the URL take `[a-z0-9-]` only, which a renamed file may not. */
function importSlug(fileSlug: string, bytes: Uint8Array): string {
  const safe = fileSlug.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${IMPORTED_SLUG_PREFIX}${safe}-${contentHash(bytes)}`;
}

export function withOwner(
  entry: LapImport,
  owner: LapImportOwner | null,
): LapImport {
  return {
    ...entry,
    owner,
    recording: {
      ...entry.recording,
      manifest: applyImportOwner(entry.raw, entry.slug, owner),
    },
  };
}

function toLapImport(
  record: StoredLapImport,
  opened: OpenedLapRecording,
): LapImport {
  return withOwner(
    { ...record, raw: opened.manifest, recording: opened },
    record.owner,
  );
}

/** Reopen a stored import; throws the reader's error for a file it cannot read. */
export async function openStoredImport(
  record: StoredLapImport,
): Promise<LapImport> {
  const opened = await openLapRecording(record.data, {
    fileName: record.fileName,
  });
  return toLapImport(record, opened);
}

/** Read a dropped file into an import keyed by its name and content. */
export async function openDroppedFile(file: File): Promise<LapImport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const opened = await openLapRecording(bytes, { fileName: file.name });
  return toLapImport(
    {
      slug: importSlug(opened.manifest.slug, bytes),
      fileName: file.name,
      data: file,
      owner: null,
      importedAt: new Date().toISOString(),
    },
    opened,
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(LAP_IMPORTS_DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(LAP_IMPORTS_STORE_NAME, {
        keyPath: "slug",
      });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LAP_IMPORTS_STORE_NAME, mode);
    const request = action(transaction.objectStore(LAP_IMPORTS_STORE_NAME));
    // A write is only durable once its transaction commits; a quota error
    // aborts it after the request itself succeeded.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? request.error);
  });
}

/** Lap telemetry waits for stored imports; a hung IndexedDB must not stall it. */
const STORAGE_TIMEOUT_MS = 3_000;

// Storage can be unavailable (some private windows): imports then last for
// the visit only, which beats refusing the file.
export async function readStoredImports(): Promise<StoredLapImport[]> {
  try {
    return await Promise.race([
      run("readonly", (store) => store.getAll()),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("IndexedDB timed out")),
          STORAGE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    console.warn("Lap imports unavailable", error);
    return [];
  }
}

export async function writeStoredImport(record: StoredLapImport) {
  try {
    await run("readwrite", (store) => store.put(record));
  } catch (error) {
    console.warn("Could not save lap import", error);
  }
}

export async function deleteStoredImport(slug: string) {
  try {
    await run("readwrite", (store) => store.delete(slug));
  } catch (error) {
    console.warn("Could not delete lap import", error);
  }
}
