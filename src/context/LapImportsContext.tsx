import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { lapRecordingKeys } from "../queries/lapRecordings";
import type { LapRecordingSummary } from "../utils/lapRecording/types";
import {
  deleteStoredImport,
  openDroppedFile,
  openStoredImport,
  readStoredImports,
  withOwner,
  writeStoredImport,
  type LapImport,
  type LapImportOwner,
  type StoredLapImport,
} from "./lapImports";
import { useTelemetry } from "./TelemetryContext";

interface LapImportsContextValue {
  /** Newest first. */
  imports: readonly LapImport[];
  /** False until stored imports are open, so a shared selection waits for them. */
  ready: boolean;
  /** Imports `.pngt` files; resolves to the slugs added and the files that failed. */
  importFiles: (
    files: readonly File[],
  ) => Promise<{ slugs: string[]; failed: string[] }>;
  setOwner: (slug: string, owner: LapImportOwner | null) => void;
  remove: (slug: string) => void;
  /** The import waiting for "whose laps are these", shown by `LapImportDialog`. */
  prompt: LapImport | undefined;
  askOwner: (slug: string) => void;
  /** Takes the slug so a repeated close cannot dismiss the next file's prompt. */
  closePrompt: (slug: string) => void;
}

const LapImportsContext = createContext<LapImportsContextValue | null>(null);

export function useLapImports() {
  const ctx = useContext(LapImportsContext);
  if (!ctx)
    throw new Error("useLapImports must be used within LapImportsProvider");
  return ctx;
}

/** IndexedDB clones plain data only; the opened archive stays in memory. */
function stored(entry: LapImport): StoredLapImport {
  const { slug, fileName, data, owner, importedAt } = entry;
  return { slug, fileName, data, owner, importedAt };
}

function newestFirst(entries: readonly LapImport[]): LapImport[] {
  return [...entries].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

/**
 * Owns browser imports and mirrors them into the shared lap-recording store,
 * which every data mode reads first (see `queries/lapRecordings.ts`).
 */
export function LapImportsProvider({ children }: { children: ReactNode }) {
  const { mode, lapRecordingStore } = useTelemetry();
  const queryClient = useQueryClient();
  const [imports, setImports] = useState<LapImport[]>([]);
  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  // Imports opened at startup, so a drop meanwhile keeps their saved owner.
  const startupImports = useRef<Promise<LapImport[]>>(Promise.resolve([]));
  const importsRef = useRef(imports);
  useEffect(() => {
    importsRef.current = imports;
  }, [imports]);

  // The list and that recording's manifest re-read the store; lap bytes
  // never change, so cached traces stay.
  const refresh = useCallback(
    (slug: string) => {
      void queryClient.invalidateQueries({
        queryKey: lapRecordingKeys.list(mode),
      });
      void queryClient.invalidateQueries({
        queryKey: lapRecordingKeys.manifest(mode, slug),
      });
    },
    [mode, queryClient],
  );

  useEffect(() => {
    let cancelled = false;
    const load = (async () => {
      const opened: LapImport[] = [];
      for (const result of await Promise.allSettled(
        (await readStoredImports()).map(openStoredImport),
      )) {
        if (result.status === "fulfilled") opened.push(result.value);
        else console.warn("Skipping unreadable lap import", result.reason);
      }
      return opened;
    })();
    startupImports.current = load;
    void load.then((opened) => {
      if (cancelled) return;
      for (const entry of opened) {
        lapRecordingStore.set(entry.slug, entry.recording);
      }
      // A file dropped while these were opening is newer; keep it.
      setImports((current) =>
        newestFirst([
          ...current,
          ...opened.filter((entry) =>
            current.every((other) => other.slug !== entry.slug),
          ),
        ]),
      );
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [lapRecordingStore]);

  const importFiles = useCallback(
    async (files: readonly File[]) => {
      const added: LapImport[] = [];
      const failed: string[] = [];
      const known = [...importsRef.current, ...(await startupImports.current)];
      for (const file of files) {
        try {
          const entry = await openDroppedFile(file);
          // The same file again keeps the owner picked last time.
          const previous = known.find((other) => other.slug === entry.slug);
          added.push(previous ? withOwner(entry, previous.owner) : entry);
        } catch (error) {
          // The reader's version error helps; zip internals do not.
          const message =
            error instanceof Error &&
            error.message.startsWith("Unsupported lap recording")
              ? error.message
              : "not a Pits n' Giggles lap file";
          failed.push(`${file.name} (${message})`);
        }
      }
      for (const entry of added) {
        lapRecordingStore.set(entry.slug, entry.recording);
        await writeStoredImport(stored(entry));
        refresh(entry.slug);
      }
      const slugs = added.map((entry) => entry.slug);
      setImports((current) =>
        newestFirst([
          ...added,
          ...current.filter((entry) => !slugs.includes(entry.slug)),
        ]),
      );
      setQueue((current) => [
        ...current.filter((slug) => !slugs.includes(slug)),
        ...slugs,
      ]);
      return { slugs, failed };
    },
    [lapRecordingStore, refresh],
  );

  const setOwner = useCallback(
    (slug: string, owner: LapImportOwner | null) => {
      const entry = imports.find((other) => other.slug === slug);
      if (!entry) return;
      const next = withOwner(entry, owner);
      lapRecordingStore.set(slug, next.recording);
      void writeStoredImport(stored(next));
      setImports((current) =>
        current.map((other) => (other.slug === slug ? next : other)),
      );
      refresh(slug);
    },
    [imports, lapRecordingStore, refresh],
  );

  const remove = useCallback(
    (slug: string) => {
      lapRecordingStore.delete(slug);
      void deleteStoredImport(slug);
      setImports((current) => current.filter((entry) => entry.slug !== slug));
      setQueue((current) => current.filter((other) => other !== slug));
      // Drop it from the list at once: refetching its manifest would hit the
      // API with a slug only this browser knows and flash a load error.
      queryClient.setQueryData<LapRecordingSummary[]>(
        lapRecordingKeys.list(mode),
        (list) => list?.filter((recording) => recording.slug !== slug),
      );
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] === "lap-recordings" &&
          query.queryKey.includes(slug),
      });
    },
    [lapRecordingStore, mode, queryClient],
  );

  const askOwner = useCallback((slug: string) => {
    setQueue((current) => [slug, ...current.filter((other) => other !== slug)]);
  }, []);
  const closePrompt = useCallback((slug: string) => {
    setQueue((current) => current.filter((other) => other !== slug));
  }, []);

  const prompt = useMemo(
    () => imports.find((entry) => entry.slug === queue[0]),
    [imports, queue],
  );

  return (
    <LapImportsContext.Provider
      value={{
        imports,
        ready,
        importFiles,
        setOwner,
        remove,
        prompt,
        askOwner,
        closePrompt,
      }}
    >
      {children}
    </LapImportsContext.Provider>
  );
}
