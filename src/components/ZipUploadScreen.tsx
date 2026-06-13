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
} from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import {
  AUTHOR_GITHUB_URL,
  AUTHOR_NAME,
  AUTHOR_SITE_URL,
  REPO_URL,
} from "../utils/links";
import { AppBrand } from "./AppBrand";
import { Modal } from "./ui/Modal";
import { HStack, VStack } from "./ui/Stack";

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
    setShowUploadModal(false);
  }, [setShowUploadModal]);

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
    <Modal onClose={dismissable ? close : undefined} className="max-w-xl">
      {/* Header */}
      <div className="w-full px-10 pt-10 pb-6 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          <AppBrand />
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
          <HStack className="text-zinc-400">
            <Grid3x3 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Sector-by-sector breakdown
          </HStack>
          <HStack className="text-zinc-400">
            <ChartLine className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Driver-vs-driver comparison
          </HStack>
          <HStack className="text-zinc-400">
            <Layers className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Stint strategy &amp; tyre wear
          </HStack>
          <HStack className="text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Progress tracking over time
          </HStack>
          <HStack className="text-zinc-400">
            <Timer className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Pace &amp; consistency metrics
          </HStack>
          <HStack className="text-zinc-400">
            <Flag className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Race &amp; qualifying analysis
          </HStack>
        </div>
      </div>

      {/* Upload zone */}
      <div className="w-full px-8">
        <VStack
          onClick={() => inputRef.current?.click()}
          align="center"
          className="cursor-pointer gap-3 rounded-xl border-2 border-dashed border-zinc-700 px-6 py-8 text-center transition-colors hover:border-zinc-500 hover:bg-zinc-900/30"
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
              <HStack justify="center" className="h-10 w-10 rounded-full bg-zinc-900">
                <Upload className="h-4 w-4 text-zinc-400" />
              </HStack>
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Drop or select telemetry files
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  .json session files, or a .zip of your data folder
                </p>
              </div>
              {error && <p className="text-xs text-behind">{error}</p>}
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
        </VStack>
      </div>

      {/* Info footer */}
      <div className="w-full px-10 pt-6 pb-8 text-center space-y-4">
        <div className="h-px bg-zinc-900" />
        <HStack as="p" justify="center" className="gap-1.5 text-xs text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5 text-ahead" />
          100% client-side — your telemetry never leaves your browser
        </HStack>
        <HStack justify="center" className="text-xs text-zinc-500">
          <span>Vibecoded by</span>
          <a
            href={AUTHOR_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/80 transition-colors"
          >
            <img
              src={`${AUTHOR_GITHUB_URL}.png`}
              alt=""
              className="h-3.5 w-3.5 rounded-full"
            />
            <span>{AUTHOR_NAME}</span>
          </a>
          <span>·</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Github className="h-3 w-3" />
            <span>View source on GitHub</span>
          </a>
        </HStack>
      </div>
    </Modal>
  );
}
