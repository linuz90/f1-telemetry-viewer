import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Bell, FolderUp, Menu, Upload, X } from "lucide-react";
import { SessionList } from "./SessionList";
import { ChangelogModal } from "./ChangelogModal";
import { useTelemetry } from "../context/TelemetryContext";
import changelog from "virtual:changelog";

const MIN_WIDTH = 250;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288; // 72 * 4 (w-72)
const STORAGE_KEY = "sidebar-width";
const CHANGELOG_SEEN_KEY = "changelog-last-seen";

function getInitialWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = Number(stored);
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  }
  return DEFAULT_WIDTH;
}

export function Layout() {
  const { mode, setShowUploadModal } = useTelemetry();
  const [width, setWidth] = useState(getInitialWidth);
  const [showChangelog, setShowChangelog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const latestHash = changelog[0]?.hash ?? "";
  const [hasUnseen, setHasUnseen] = useState(
    () => latestHash !== "" && localStorage.getItem(CHANGELOG_SEEN_KEY) !== latestHash,
  );
  const dragging = useRef(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const openChangelog = useCallback(() => {
    setShowChangelog(true);
    if (latestHash) {
      localStorage.setItem(CHANGELOG_SEEN_KEY, latestHash);
      setHasUnseen(false);
    }
  }, [latestHash]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(newWidth);
    };

    const onMouseUp = (e: MouseEvent) => {
      dragging.current = false;
      const finalWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      localStorage.setItem(STORAGE_KEY, String(finalWidth));
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 border-r border-zinc-800/60 bg-black overflow-y-auto
          transition-transform duration-200 ease-in-out
          md:relative md:z-0 md:translate-x-0 md:shrink-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={{ width }}
      >
        <div className="p-4 border-b border-zinc-800/60">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity">
              <span className="text-red-500">F1</span> Telemetry Viewer
            </Link>
            <div className="flex items-center gap-1">
              <button
                onClick={openChangelog}
                title="What's new"
                className="relative rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
              >
                <Bell className="h-4 w-4" />
                {hasUnseen && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </button>
              {(mode === "upload" || mode === "demo") && (
                <button
                  onClick={() => setShowUploadModal(true)}
                  title="Load different data"
                  className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
                >
                  <FolderUp className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors md:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <SessionList />
      </aside>

      {/* Resize handle — desktop only */}
      <div
        className="absolute top-0 bottom-0 z-10 w-2 -ml-1 cursor-col-resize hidden md:block"
        style={{ left: width }}
        onMouseDown={onMouseDown}
      />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-black">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800/60 bg-black/90 backdrop-blur px-4 py-3 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="text-base font-bold tracking-tight">
            <span className="text-red-500">F1</span> Telemetry Viewer
          </Link>
        </div>

        {mode === "demo" && (
          <div className="border-b border-zinc-800/60 bg-gradient-to-r from-zinc-950 via-zinc-900/50 to-zinc-950 px-6 py-5">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight">
                  <span className="text-red-500">F1</span> Telemetry Viewer
                </h2>
                <p className="mt-0.5 text-sm text-zinc-400">
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
                className="flex shrink-0 items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                Get started
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>

      {showChangelog && (
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      )}
    </div>
  );
}
