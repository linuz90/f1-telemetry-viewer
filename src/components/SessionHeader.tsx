import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { TelemetrySession } from "../types/telemetry";
import { formatSessionType } from "../utils/format";
import {
  getFormulaComparisonKey,
  getFormulaLabel,
  shouldShowFormulaLabel,
} from "../utils/sessionTypes";
import { trackPath, trackTabForSessionType } from "../utils/routes";
import { TrackFlag } from "./TrackFlag";
import { TrackLayout } from "./TrackLayout";
import { SessionDriverSelect } from "./SessionDriverSelect";
import { getSessionTypeMeta } from "./sessionTypeMeta";
import { HStack } from "./ui/Stack";

const EXT_LINK_TEMPLATE = import.meta.env.VITE_EXTERNAL_LINK_TEMPLATE as
  | string
  | undefined;
const EXT_LINK_LABEL = import.meta.env.VITE_EXTERNAL_LINK_LABEL as
  | string
  | undefined;

interface SessionHeaderProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
  onFocusedDriverChange: (index: number) => void;
  controls?: ReactNode;
  slug?: string;
  showDriverSelector?: boolean;
  showTrackLayout?: boolean;
}

export function SessionHeader({
  session,
  focusedDriverIndex,
  onFocusedDriverChange,
  controls,
  slug,
  showDriverSelector = true,
  showTrackLayout = true,
}: SessionHeaderProps) {
  const info = session["session-info"];

  const sessionType = formatSessionType(info["session-type"], info.formula);
  const TypeIcon = getSessionTypeMeta(sessionType).icon;
  const formulaKey = getFormulaComparisonKey(
    info.formula,
    session["game-year"],
  );
  const showFormula = shouldShowFormulaLabel(
    info.formula,
    session["game-year"],
  );
  const trackTab = trackTabForSessionType(info["session-type"]);

  return (
    <HStack align="start" className="gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        {/* Title row */}
        <HStack className="gap-3">
          <h2 className="text-xl font-bold">
            <Link
              to={trackPath(formulaKey, info["track-id"], trackTab)}
              className="hover:text-best transition-colors"
            >
              <TrackFlag track={info["track-id"]} className="mr-1" />{" "}
              {info["track-id"]}
            </Link>
          </h2>
          <HStack as="span" className="gap-1 text-sm text-zinc-400">
            <TypeIcon className="size-3.5" />
            {sessionType}
          </HStack>
          {showFormula && (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-zinc-400">
              {getFormulaLabel(info.formula, session["game-year"])}
            </span>
          )}
        </HStack>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-zinc-400">
          {showDriverSelector && (
            <SessionDriverSelect
              session={session}
              focusedDriverIndex={focusedDriverIndex}
              onFocusedDriverChange={onFocusedDriverChange}
            />
          )}

          {slug && EXT_LINK_TEMPLATE && EXT_LINK_LABEL && (
            <a
              href={EXT_LINK_TEMPLATE.replace("{slug}", slug)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 transition-colors text-xs"
            >
              <ExternalLink className="size-3" />
              {EXT_LINK_LABEL}
            </a>
          )}

          {controls && <div className="contents">{controls}</div>}
        </div>
      </div>
      {showTrackLayout && (
        <TrackLayout
          track={info["track-id"]}
          className="hidden sm:block size-20 shrink-0 text-zinc-600 [&>svg]:size-full"
        />
      )}
    </HStack>
  );
}
