export const TRACKS_ROUTE_SEGMENT = "tracks";
export const SESSIONS_ROUTE_SEGMENT = "sessions";
export const FORM_ROUTE_SEGMENT = "form";
export const TRACK_TAB_QUERY_PARAM = "tab";
/** Session pages keep their open tab in the URL too, so a tab is linkable. */
export const SESSION_TAB_QUERY_PARAM = "tab";

/** Track tabs that hold one session kind's history. */
export const TRACK_SESSION_TABS = ["qualifying", "race", "time-trial"] as const;

export type TrackSessionTab = (typeof TRACK_SESSION_TABS)[number];

/** Every track-page tab, in display order. */
export const TRACK_PAGE_TABS = [
  "overview",
  "qualifying",
  "race",
  "time-trial",
  "lap-telemetry",
  "setups",
  "sessions",
] as const;

export type TrackPageTab = (typeof TRACK_PAGE_TABS)[number];
