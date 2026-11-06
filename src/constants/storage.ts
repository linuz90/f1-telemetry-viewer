export const PLAYER_ONLY_STORAGE_KEY = "player-only";
export const PLAYER_ONLY_CHANGED_EVENT = "player-only-changed";

export const SESSION_FILTERS_STORAGE_KEY = "session-list-filters";
export const SESSION_FILTERS_CHANGED_EVENT = "session-list-filters-changed";

export const CHANGELOG_SEEN_STORAGE_KEY = "changelog-last-seen";

export const LAP_TRACE_PANES_STORAGE_KEY = "f1.lapTelemetry.panes";
export const LAP_TRACE_HEIGHTS_STORAGE_KEY = "f1.lapTelemetry.paneHeights";
export const LAP_INPUT_GHOST_STORAGE_KEY = "f1.lapTelemetry.inputGhost";

/** Circuits whose collapsed-by-default section the user left open. */
export const LAP_TIPS_OPEN_STORAGE_KEY = "f1.lapTelemetry.tipsOpen";

/** IndexedDB database and object store holding imported `.pngt` files. */
export const LAP_IMPORTS_DB_NAME = "f1-telemetry-viewer";
export const LAP_IMPORTS_STORE_NAME = "lap-imports";
