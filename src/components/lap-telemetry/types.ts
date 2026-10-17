import type { LapCandidate } from "../../analysis/lapTelemetrySelection";

export const SLOT_NAMES = ["A", "B"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** A selected lap as the section renders it. */
export interface SlotLap {
  slot: SlotName;
  key: string;
  color: string;
  /** "You" or the driver's name. */
  label: string;
  candidate: LapCandidate;
  /** "Session best · Short Quali · 5 Oct 20:49 · Lap 1 · Soft" */
  detail: string;
}
