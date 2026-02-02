import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, X } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";

export function ZipUploadScreen({ dismissable = false }: { dismissable?: boolean }) {
  const { loadZip, zipLoading, setShowUploadModal } = useTelemetry();
  const navigate = useNavigate();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    if (dismissable) setShowUploadModal(false);
  }, [dismissable, setShowUploadModal]);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.endsWith(".zip")) {
        setError("Please upload a .zip file");
        return;
      }
      try {
        await loadZip(file);
        setShowUploadModal(false);
        navigate("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load zip file");
      }
    },
    [loadZip, setShowUploadModal, navigate],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={dismissable ? close : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-lg flex-col items-center rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden"
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
          <p className="mt-2 text-sm text-zinc-400">
            Visualize your lap times, compare rivals, and track your progress across sessions.
          </p>
        </div>

        {/* Upload zone */}
        <div className="w-full px-8">
          <div
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragOver
                ? "border-red-500 bg-red-500/5"
                : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/30"
            }`}
          >
            {zipLoading ? (
              <>
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-zinc-600 border-t-red-500" />
                <div>
                  <p className="text-sm font-medium text-zinc-200">Loading telemetry data...</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Extracting and parsing session files</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900">
                  <Upload className="h-4 w-4 text-zinc-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">
                    Drop a <span className="text-zinc-100">.zip</span> here or click to browse
                  </p>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={onFileSelect}
            />
          </div>
        </div>

        {/* Info footer */}
        <div className="w-full px-10 pt-6 pb-8 text-center space-y-4">
          <p className="text-xs leading-relaxed text-zinc-500">
            Works with JSON telemetry files from{" "}
            <a
              href="https://www.pitsngiggles.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-400 hover:text-red-300 underline underline-offset-2"
            >
              Pits n' Giggles
            </a>
            {" "}— a self-engineering tool for F1 23, F1 24, and F1 25.
            Just zip your telemetry data folder and drop it above.
          </p>
          <div className="h-px bg-zinc-900" />
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
          </div>
        </div>
      </div>
    </div>
  );
}
