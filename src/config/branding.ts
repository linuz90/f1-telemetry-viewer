const configuredAppName = import.meta.env.VITE_APP_NAME?.trim();

export const APP_NAME = configuredAppName || "F1 Telemetry Viewer";
export const PNG_VERSION_TITLE_PREFIX = "Pits n' Giggles - Save";
