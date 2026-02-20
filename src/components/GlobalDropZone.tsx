import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";

export function GlobalDropZone() {
  const { loadFiles, filesLoading, setShowUploadModal } = useTelemetry();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  // Auto-dismiss error after 3s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(t);
  }, [error]);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      counter.current = 0;
      setVisible(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      const valid = files.filter(
        (f) => f.name.endsWith(".zip") || f.name.endsWith(".json"),
      );
      if (valid.length === 0) return;
      try {
        setShowUploadModal(false);
        await loadFiles(valid);
        navigate("/");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load files",
        );
      }
    },
    [loadFiles, setShowUploadModal, navigate],
  );

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      counter.current++;
      if (e.dataTransfer?.types?.includes("Files")) {
        setVisible(true);
      }
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      counter.current--;
      if (counter.current <= 0) {
        counter.current = 0;
        setVisible(false);
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      handleDrop(e);
    };

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);

    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [handleDrop]);

  return (
    <>
      {/* Error toast */}
      {error && (
        <div className="fixed top-4 left-1/2 z-[101] -translate-x-1/2 rounded-lg bg-red-950 border border-red-800 px-4 py-2.5 text-sm text-red-200 shadow-lg">
          {error}
        </div>
      )}

      {/* Drop overlay */}
      {(visible || filesLoading) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity">
          <div className="flex flex-col items-center gap-4">
            {filesLoading ? (
              <>
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-600 border-t-red-500" />
                <p className="text-lg font-medium text-zinc-200">
                  Loading telemetry...
                </p>
              </>
            ) : (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-red-500/60 bg-red-500/10">
                  <Upload className="h-7 w-7 text-red-400" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium text-zinc-200">
                    Drop telemetry files
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    .json session files or a .zip of your data folder
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
