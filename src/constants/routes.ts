export const TRACKS_ROUTE_SEGMENT = "tracks";
export const SESSIONS_ROUTE_SEGMENT = "sessions";
export const TRACK_TAB_QUERY_PARAM = "tab";

export const TRACK_SESSION_TABS = ["qualifying", "race", "time-trial"] as const;

export type TrackSessionTab = (typeof TRACK_SESSION_TABS)[number];
