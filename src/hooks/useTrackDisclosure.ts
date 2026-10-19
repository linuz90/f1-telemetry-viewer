import { useState } from "react";
import { readStoredString, writeStoredString } from "../utils/storage";
import { getTrackId } from "../utils/tracks";

function readOpenTrackIds(storageKey: string): string[] {
  try {
    const stored: unknown = JSON.parse(readStoredString(storageKey) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Open state of a section that starts collapsed, remembered per circuit: open
 * it while working on Suzuka and it stays open on every Suzuka page, without
 * opening it at other tracks. Only open circuits are stored, so the list
 * stays as short as the calendar. Without a track the state is local.
 */
export function useTrackDisclosure(
  storageKey: string,
  track: string | undefined,
) {
  const trackId = track ? getTrackId(track) : "";
  const [openIds, setOpenIds] = useState(() => readOpenTrackIds(storageKey));
  const [localOpen, setLocalOpen] = useState(false);
  const open = trackId ? openIds.includes(trackId) : localOpen;

  const setOpen = (next: boolean) => {
    if (!trackId) {
      setLocalOpen(next);
      return;
    }
    // Re-read so another tab's or section's circuits are kept.
    const ids = readOpenTrackIds(storageKey).filter((id) => id !== trackId);
    if (next) ids.push(trackId);
    writeStoredString(storageKey, JSON.stringify(ids));
    setOpenIds(ids);
  };

  return [open, setOpen] as const;
}
