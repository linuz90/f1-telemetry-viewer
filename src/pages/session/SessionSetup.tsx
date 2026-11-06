import { Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import type { DriverData } from "../../types/telemetry";
import type { SessionKind } from "../../analysis/sessionKind";
import { useTelemetry } from "../../context/TelemetryContext";
import { msToLapTime } from "../../utils/format";
import { getTrackDisplayName, getTrackId } from "../../utils/tracks";
import { trackPath } from "../../utils/routes";
import { EmptyState } from "../../components/EmptyState";
import { panelGridClass } from "../../components/ui/Panel";
import { SetupPanel, SetupSheet } from "../../components/session/SessionParts";

/**
 * A session's Setup tab: its setup in the track Setups tab's card, titled by
 * the lap it set, with a link to every setup run at the track.
 */
export function SessionSetup({
  kind,
  driver,
  bestLapMs,
  trackName,
}: {
  kind: SessionKind;
  driver: DriverData;
  bestLapMs: number;
  trackName: string;
}) {
  const { activeFormulaKey } = useTelemetry();
  const setup = driver["car-setup"];
  return (
    <div className={panelGridClass}>
      <SetupPanel
        kind={kind}
        aside={
          activeFormulaKey && (
            <Link
              to={trackPath(activeFormulaKey, getTrackId(trackName), "setups")}
              className="text-xs text-tone-500 hover:text-tone-100"
            >
              {getTrackDisplayName(trackName)} setups →
            </Link>
          )
        }
      >
        {setup?.["is-valid"] && driver["is-player"] ? (
          <SetupSheet
            setup={setup}
            title={
              bestLapMs > 0 ? (
                <>
                  Best lap{" "}
                  <span className="font-mono">{msToLapTime(bestLapMs)}</span>
                </>
              ) : (
                "No timed lap"
              )
            }
          />
        ) : (
          <EmptyState
            icon={SlidersHorizontal}
            {...(driver["is-player"]
              ? {
                  title: "No setup in this save",
                  message: "The game didn't export your setup this time.",
                }
              : {
                  title: "No setup for this driver",
                  message: "The game only exports your own setup.",
                })}
          />
        )}
      </SetupPanel>
    </div>
  );
}
