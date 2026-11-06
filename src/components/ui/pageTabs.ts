import {
  CalendarDays,
  ChartSpline,
  CircleDot,
  LayoutDashboard,
  Repeat,
  SlidersHorizontal,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { TrackPageTab } from "../../constants/routes";
import { cn } from "../../utils/cn";
import { TRACK_KIND_META } from "../sessionTypeMeta";

/**
 * Session and track pages switch tabs in place, under a tall hero. The tab
 * bar sticks under the top bar (`h-14`), so a long tab can switch without
 * scrolling back up.
 */
export const pageTabBarClass =
  "sticky top-14 z-30 bg-canvas/90 pt-3 backdrop-blur-md";

/**
 * The row of tabs scrolls sideways on narrow screens. The tabs' underline
 * overlaps the row's border (`-mb-px`), which would also let the row scroll
 * a pixel vertically under a trackpad, so that axis is locked.
 */
export const pageTabListClass =
  "flex gap-5 overflow-x-auto overflow-y-hidden text-sm";

/**
 * Sticky elements inside a tab panel (driver panel, lap map) sit below the
 * stuck tab bar.
 */
export const stickyBelowPageTabsClass = "lg:sticky lg:top-30";

/** Scroll targets inside a tab panel stop below the stuck tab bar. */
export const scrollBelowPageTabsClass = "scroll-mt-30";

/**
 * A shorter tab would shrink the page below the current scroll and the
 * browser would clamp it, throwing the page back to the top, so the panel
 * always spans a screen below the top bar: the tab bar stays where it was
 * clicked.
 */
export const pageTabPanelClass = "min-h-[calc(100vh-3.5rem)]";

/**
 * Tabs show focus by their underline, not the global outline ring, which the
 * scrolling tab row would clip into stray vertical lines.
 */
export function pageTabClass(selected: boolean) {
  return cn(
    "-mb-px border-b-2 pb-2.5 whitespace-nowrap transition-colors focus-visible:outline-none",
    selected
      ? "border-tone-50 font-medium text-tone-50"
      : "border-transparent text-tone-400 hover:text-tone-100 focus-visible:border-tone-500 focus-visible:text-tone-100",
  );
}

/** Every tab a session or track page can show. */
export type PageTabKey = TrackPageTab | "laps" | "tyres" | "results" | "setup";

/**
 * Each tab's glyph, shared so a tab reads the same on session and track
 * pages. Session-kind tabs take the kind's glyph; the rest reuse the icon the
 * app already gives that section (lap telemetry, setups).
 */
export const PAGE_TAB_ICONS: Record<PageTabKey, LucideIcon> = {
  overview: LayoutDashboard,
  qualifying: TRACK_KIND_META.qualifying.icon,
  race: TRACK_KIND_META.race.icon,
  "time-trial": TRACK_KIND_META["time-trial"].icon,
  laps: Repeat,
  tyres: CircleDot,
  "lap-telemetry": ChartSpline,
  results: Trophy,
  // One session's setup and a track's setups are the same thing, one or many.
  setup: SlidersHorizontal,
  setups: SlidersHorizontal,
  sessions: CalendarDays,
};

export const PAGE_TAB_BAR_ID = "page-tabs";
export const PAGE_TAB_PANEL_ID = "page-tab-panel";

/**
 * A new tab opens at its start: switching from deep in a tab (the bar stuck
 * over its content) scrolls back to where the bar stops sticking, and a
 * switch from where the bar is below the screen (a summary card above it)
 * brings it up under the top bar. A switch made with the bar in its own
 * place keeps the scroll. Called before the switch renders; the panel's min
 * height keeps those positions reachable.
 */
export function revealPageTabBar() {
  const bar = document.getElementById(PAGE_TAB_BAR_ID);
  const panel = document.getElementById(PAGE_TAB_PANEL_ID);
  if (!bar || !panel) return;
  const barBox = bar.getBoundingClientRect();
  const panelStart =
    barBox.bottom + parseFloat(getComputedStyle(panel).marginTop);
  const scrolledIn = panel.getBoundingClientRect().top - panelStart;
  if (scrolledIn < -1) {
    window.scrollBy(0, scrolledIn);
  } else if (barBox.bottom > window.innerHeight) {
    window.scrollBy(0, barBox.top - parseFloat(getComputedStyle(bar).top));
  }
}
