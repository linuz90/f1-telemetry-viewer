export type BrowserStorageKind = "local" | "session";

interface StoredNumberOptions {
  kind?: BrowserStorageKind;
  fallback: number;
  min?: number;
  max?: number;
}

function getBrowserStorage(kind: BrowserStorageKind): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredString(
  key: string,
  kind: BrowserStorageKind = "local",
): string | null {
  try {
    return getBrowserStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredString(
  key: string,
  value: string,
  kind: BrowserStorageKind = "local",
): void {
  try {
    getBrowserStorage(kind)?.setItem(key, value);
  } catch {
    // Storage can fail in private windows or when the quota is exhausted.
  }
}

export function readStoredBoolean(
  key: string,
  kind: BrowserStorageKind = "local",
  fallback = false,
): boolean {
  const value = readStoredString(key, kind);
  return value == null ? fallback : value === "true";
}

export function writeStoredBoolean(
  key: string,
  value: boolean,
  kind: BrowserStorageKind = "local",
): void {
  writeStoredString(key, String(value), kind);
}

export function readStoredNumber(
  key: string,
  { kind = "local", fallback, min, max }: StoredNumberOptions,
): number {
  const value = readStoredString(key, kind);
  if (value == null) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (min != null && parsed < min) return fallback;
  if (max != null && parsed > max) return fallback;
  return parsed;
}
