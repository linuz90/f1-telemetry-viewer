import { useCallback, useRef, useState } from "react";
import { Outlet, Link } from "react-router-dom";
import { FolderUp } from "lucide-react";
import { SessionList } from "./SessionList";
import { useTelemetry } from "../context/TelemetryContext";

const MIN_WIDTH = 250;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288; // 72 * 4 (w-72)
const STORAGE_KEY = "sidebar-width";

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
  const dragging = useRef(false);

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
      {/* Sidebar */}
      <aside
        className="relative shrink-0 border-r border-zinc-800/60 bg-black overflow-y-auto"
        style={{ width }}
      >
        <div className="p-4 border-b border-zinc-800/60">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity">
              <span className="text-red-500">F1</span> Telemetry Viewer
            </Link>
            {mode === "upload" && (
              <button
                onClick={() => setShowUploadModal(true)}
                title="Load different data"
                className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
              >
                <FolderUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <SessionList />
      </aside>

      {/* Resize handle (overlaps sidebar edge so it doesn't create a visible strip) */}
      <div
        className="absolute top-0 bottom-0 z-10 w-2 -ml-1 cursor-col-resize"
        style={{ left: width }}
        onMouseDown={onMouseDown}
      />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-black">
        <Outlet />
      </main>
    </div>
  );
}
