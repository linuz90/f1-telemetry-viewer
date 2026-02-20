import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChartLine,
  Flag,
  Github,
  Grid3x3,
  Layers,
  ShieldCheck,
  Timer,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";

export function ZipUploadScreen({
  dismissable = false,
}: {
  dismissable?: boolean;
}) {
  const { loadFiles, filesLoading, setShowUploadModal } = useTelemetry();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    if (dismissable) setShowUploadModal(false);
  }, [dismissable, setShowUploadModal]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const valid = files.filter(
        (f) => f.name.endsWith(".zip") || f.name.endsWith(".json"),
      );
      if (valid.length === 0) {
        setError("Please upload .zip or .json files");
        return;
      }
      try {
        await loadFiles(valid);
        setShowUploadModal(false);
        navigate("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load files");
      }
    },
    [loadFiles, setShowUploadModal, navigate],
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={dismissable ? close : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-xl flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden"
      >
        {dismissable && (
          <button
            onClick={close}
            className="absolute top-4 right-4 z-10 rounded-lg p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Header */}
        <div className="w-full px-10 pt-10 pb-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            <span className="text-red-500">F1</span> Telemetry Viewer
          </h2>
          <p className="mt-4 text-base text-zinc-300">
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
          <div className="mx-auto mt-5 mb-2 grid grid-cols-2 gap-x-8 gap-y-3 text-left text-sm">
            <div className="flex items-center gap-2 text-zinc-400">
              <Grid3x3 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              Sector-by-sector breakdown
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <ChartLine className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              Driver-vs-driver comparison
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <Layers className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              Stint strategy &amp; tyre wear
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              Progress tracking over time
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <Timer className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              Pace &amp; consistency metrics
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              <Flag className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              Race &amp; qualifying analysis
            </div>
          </div>
        </div>

        {/* Upload zone */}
        <div className="w-full px-8">
          <div
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/30 px-6 py-8 text-center transition-colors"
          >
            {filesLoading ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-zinc-600 border-t-red-500" />
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Loading telemetry data...
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Extracting and parsing session files
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900">
                  <Upload className="h-4 w-4 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Drop or select telemetry files
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    .json session files, or a .zip of your data folder
                  </p>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".zip,.json"
              multiple
              className="hidden"
              onChange={onFileSelect}
            />
          </div>
        </div>

        {/* Info footer */}
        <div className="w-full px-10 pt-6 pb-8 text-center space-y-4">
          <div className="h-px bg-zinc-900" />
          <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            100% client-side — your telemetry never leaves your browser
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
            <span>Vibecoded by</span>
            <a
              href="https://fabrizio.so"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/80 transition-colors"
            >
              <img
                src="https://github.com/linuz90.png"
                alt=""
                className="h-3.5 w-3.5 rounded-full"
              />
              <span>Fabrizio Rinaldi</span>
            </a>
            <span>·</span>
            <a
              href="https://github.com/linuz90/f1-telemetry-viewer"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Github className="h-3 w-3" />
              <span>View source on GitHub</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
