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
import { useLapRecordingList } from "../hooks/useLapRecordings";
import { useLoadFiles } from "../hooks/useLoadFiles";
import {
  AUTHOR_GITHUB_URL,
  AUTHOR_NAME,
  AUTHOR_SITE_URL,
  REPO_URL,
} from "../constants/links";
import { AppBrand } from "./AppBrand";
import { DialogTitle } from "./ui/Dialog";
import { Modal } from "./ui/Modal";
import { HStack, VStack } from "./ui/Stack";

const FEATURES = [
  { icon: Grid3x3, label: "Sector-by-sector breakdown" },
  { icon: ChartLine, label: "Driver-vs-driver comparison" },
  { icon: Layers, label: "Stint strategy & tyre wear" },
  { icon: TrendingUp, label: "Progress tracking over time" },
  { icon: Timer, label: "Pace & consistency metrics" },
  { icon: Flag, label: "Race & qualifying analysis" },
];

export function ZipUploadScreen({
  dismissable = false,
}: {
  dismissable?: boolean;
}) {
  const { filesLoading, setShowUploadModal } = useTelemetry();
  const loadFiles = useLoadFiles();
  // Only Pits n' Giggles 5 records laps, so only its users hear about them.
  const recordsLaps = useLapRecordingList().recordings.length > 0;
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setShowUploadModal(false);
  }, [setShowUploadModal]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      try {
        const result = await loadFiles(files);
        if (result.kind === "none") {
          setError("Please upload .zip or .json files");
          return;
        }
        if (result.kind === "laps" && result.failed.length > 0) {
          setError(`Could not read ${result.failed.join("; ")}`);
          return;
        }
        setShowUploadModal(false);
        if (result.kind === "sessions") navigate("/");
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
    <Modal
      onClose={dismissable ? close : undefined}
      className="max-w-xl"
      footer={
        <HStack justify="between" className="gap-4">
          <HStack className="gap-1.5">
            <span>Vibecoded by</span>
            <a
              href={AUTHOR_SITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-tone-400 transition-colors hover:text-tone-200"
            >
              <img
                src={`${AUTHOR_GITHUB_URL}.png`}
                alt=""
                className="size-3.5 rounded-full"
              />
              {AUTHOR_NAME}
            </a>
          </HStack>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-tone-200"
          >
            <Github className="size-3.5" />
            Source
          </a>
        </HStack>
      }
    >
      <div className="px-6 pt-8 pb-6 text-center sm:px-8">
        <DialogTitle className="text-xl font-semibold tracking-tight">
          <AppBrand />
        </DialogTitle>
        <p className="mt-1.5 text-sm text-tone-400">
          Dive into your{" "}
          <a
            href="https://www.pitsngiggles.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-tone-200 underline decoration-tone-600 underline-offset-2 transition-colors hover:decoration-tone-300"
          >
            Pits n' Giggles
          </a>{" "}
          telemetry.
        </p>
        <div className="mx-auto mt-6 grid w-fit gap-x-6 gap-y-2.5 text-left text-sm text-tone-400 sm:w-full sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, label }) => (
            <HStack key={label} className="gap-2">
              <Icon className="size-3.5 shrink-0 text-tone-500" />
              {label}
            </HStack>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6 sm:px-8">
        <VStack
          onClick={() => inputRef.current?.click()}
          align="center"
          className="cursor-pointer gap-3 rounded-xl border border-dashed border-tone-700 px-6 py-8 text-center transition-colors hover:border-tone-500 hover:bg-tone-800/40"
        >
          {filesLoading ? (
            <>
              <div className="size-7 animate-spin rounded-full border-2 border-tone-700 border-t-tone-200" />
              <div>
                <p className="text-sm font-medium text-tone-200">
                  Loading telemetry data...
                </p>
                <p className="mt-0.5 text-xs text-tone-500">
                  Extracting and parsing session files
                </p>
              </div>
            </>
          ) : (
            <>
              <HStack
                justify="center"
                className="size-9 rounded-full bg-tone-800"
              >
                <Upload className="size-4 text-tone-300" />
              </HStack>
              <div>
                <p className="text-sm font-medium text-tone-200">
                  Drop or select telemetry files
                </p>
                <p className="mt-1 text-xs text-tone-500">
                  .json session files, or a .zip of your data folder
                  {recordsLaps && ", or a friend's .pngt laps to compare"}
                </p>
              </div>
              {error && <p className="text-xs text-behind">{error}</p>}
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.json,.pngt"
            multiple
            className="hidden"
            onChange={onFileSelect}
          />
        </VStack>
        <HStack
          as="p"
          justify="center"
          className="mt-3 gap-1.5 text-xs text-tone-500"
        >
          <ShieldCheck className="size-3.5" />
          100% client-side: your telemetry never leaves your browser
        </HStack>
      </div>
    </Modal>
  );
}
