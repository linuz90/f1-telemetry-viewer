import { useCallback } from "react";
import { useLapImports } from "../context/LapImportsContext";
import { useTelemetry } from "../context/TelemetryContext";
import { LAP_RECORDING_EXTENSION } from "../utils/lapRecording/types";

const ACCEPTED_EXTENSIONS = [".zip", ".json", LAP_RECORDING_EXTENSION];

export type LoadFilesResult =
  | { kind: "none" }
  | { kind: "sessions" }
  /** Lap imports; `failed` names files that could not be read. */
  | { kind: "laps"; failed: string[] };

/**
 * Routes dropped or picked files. `.pngt` files on their own, typically a
 * friend's laps, are imported beside the loaded data; anything else loads as
 * telemetry and replaces what is shown.
 */
export function useLoadFiles() {
  const { loadFiles, sessions } = useTelemetry();
  const { importFiles } = useLapImports();
  return useCallback(
    async (files: readonly File[]): Promise<LoadFilesResult> => {
      const valid = files.filter((file) =>
        ACCEPTED_EXTENSIONS.some((extension) => file.name.endsWith(extension)),
      );
      if (valid.length === 0) return { kind: "none" };
      // With nothing loaded there is no lap of yours to compare with, and
      // loadFiles says which files to add instead.
      if (
        sessions.length > 0 &&
        valid.every((file) => file.name.endsWith(LAP_RECORDING_EXTENSION))
      ) {
        const { slugs, failed } = await importFiles(valid);
        if (slugs.length === 0) throw new Error(failed.join("\n"));
        return { kind: "laps", failed };
      }
      await loadFiles(valid);
      return { kind: "sessions" };
    },
    [importFiles, loadFiles, sessions.length],
  );
}
