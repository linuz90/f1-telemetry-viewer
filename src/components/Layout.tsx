import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import changelog from "virtual:changelog";
import { CHANGELOG_SEEN_STORAGE_KEY } from "../constants/storage";
import { useTelemetry } from "../context/TelemetryContext";
import { cn } from "../utils/cn";
import { readStoredString, writeStoredString } from "../utils/storage";
import { AppBrand } from "./AppBrand";
import { cardHighlight } from "./Card";
import { ChangelogModal } from "./ChangelogModal";
import { CommandPalette } from "./shell/CommandPalette";
import { setCommandPaletteOpen } from "./shell/commandPaletteStore";
import { TopBar } from "./shell/TopBar";

/**
 * Window scroll positions by history entry, so Back from a session lands on
 * the same spot in the log. The browser's own restoration runs before React
 * renders the previous page, so it is switched off and done here.
 */
const scrollPositions = new Map<string, number>();

function useScrollMemory() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);

  useLayoutEffect(() => {
    const saved = scrollPositions.get(location.key);
    if (navigationType === "POP" && saved != null) {
      // Two frames: the restored page may grow its log after the first paint.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.scrollTo(0, saved)),
      );
    } else if (navigationType !== "REPLACE") {
      window.scrollTo(0, 0);
    }
  }, [location.key, navigationType]);

  useEffect(() => {
    const onScroll = () => scrollPositions.set(location.key, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [location.key]);
}

export function Layout() {
  const { mode, setShowUploadModal } = useTelemetry();
  const [showChangelog, setShowChangelog] = useState(false);
  const latestHash = changelog[0]?.hash ?? "";
  const [hasUnseen, setHasUnseen] = useState(
    () =>
      latestHash !== "" &&
      readStoredString(CHANGELOG_SEEN_STORAGE_KEY) !== latestHash,
  );
  useScrollMemory();

  const openChangelog = useCallback(() => {
    setShowChangelog(true);
    if (latestHash) {
      writeStoredString(CHANGELOG_SEEN_STORAGE_KEY, latestHash);
      setHasUnseen(false);
    }
  }, [latestHash]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar hasUnseenChangelog={hasUnseen} onOpenChangelog={openChangelog} />
      <main className="min-w-0">
        {mode === "demo" && (
          <div className="mx-auto max-w-6xl px-6 pt-6 pb-2">
            {/*
              Two-layer background: base zinc gradient stays consistent with
              the dashboard cards, then a radial red glow biased to the bottom-
              right corner so the CTA itself feels like the source of the
              accent. Kept low-opacity so it reads as ambient warmth, not a
              solid red panel.
            */}
            <div
              className={cn(
                "relative flex items-center justify-between gap-6 overflow-hidden rounded-2xl bg-gradient-to-br from-tone-800/60 via-tone-900/40 to-tone-900/20 px-6 py-5",
                cardHighlight,
              )}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(220,38,38,0.16),rgba(127,29,29,0.06)_45%,transparent_70%)]"
              />
              <div className="relative min-w-0">
                <h2 className="text-lg font-bold tracking-tight">
                  <AppBrand />
                </h2>
                <p className="mt-0.5 text-sm text-tone-400">
                  Dive into your{" "}
                  <a
                    href="https://www.pitsngiggles.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-400 hover:text-red-300 underline underline-offset-2"
                  >
                    Pits n' Giggles
                  </a>{" "}
                  telemetry.
                </p>
              </div>
              <button
                onClick={() => setShowUploadModal(true)}
                className="group relative flex shrink-0 items-center gap-1.5 rounded-xl bg-red-700/95 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-950/40"
              >
                Get started
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>
      <CommandPalette onOpenChangelog={openChangelog} />
      {showChangelog && (
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      )}
    </div>
  );
}
