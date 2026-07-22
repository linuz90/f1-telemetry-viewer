import { CircleHelp } from "lucide-react";
import type {
  AeroTendencyReason,
  DriverSpeedComparison,
} from "../analysis/speedAnalysis";
import { Card } from "./Card";
import { Tooltip } from "./Tooltip";
import { Badge, type BadgeTone } from "./ui/Badge";
import { SectionHeader } from "./ui/SectionHeader";

interface SpeedAeroComparisonProps {
  comparison: DriverSpeedComparison | null;
  focusedName: string;
  rivalName: string;
}

interface EvidenceRowProps {
  label: string;
  hint: string;
  focusedValue: number | null;
  rivalValue: number | null;
  delta: number | null;
  focusedSuffix?: string;
  rivalSuffix?: string;
  focusedName: string;
  rivalName: string;
  deltaLabel?: string;
}

const VERDICT_COPY = {
  "rival-lower-drag": "Rival trends lower-drag",
  "no-clear-difference": "No clear straight-line difference",
  "rival-higher-load": "Rival trends higher-load",
  inconclusive: "Inconclusive",
  unavailable: "Unavailable",
} as const;

type DisplayReason = AeroTendencyReason | "missing-speed";

const REASON_COPY: Record<DisplayReason, string> = {
  "not-race": "Aero tendency is available for race sessions only.",
  "wet-or-mixed":
    "Wet or mixed conditions make the straight-line signal unreliable.",
  "partial-session":
    "The race export ended before the configured distance, so the comparison is descriptive only.",
  "too-few-laps": "Too few comparable laps for a reliable comparison.",
  "compound-or-age-mismatch":
    "Some same-lap samples were excluded for different compounds or materially different tyre ages.",
  "restricted-telemetry":
    "Restricted driver telemetry leaves important setup context unknown.",
  "signals-conflict":
    "Representative speed and the fixed speed trap point in different directions.",
  "trap-lap-ineligible":
    "The best speed-trap crossing came from a lap that is not eligible for inference.",
  "overall-pace-advantage":
    "The pace evidence looks like an overall performance advantage, not an aero trade-off.",
  "unequal-cars":
    "Unequal car performance means car strength and setup cannot be separated.",
  "equal-cars-unknown":
    "Equal-car performance was not recorded, so car strength and setup cannot be separated safely.",
  "missing-trap":
    "A comparable fixed speed-trap result is missing, so the lap peaks cannot be corroborated.",
  "low-direction-agreement":
    "Comparable laps do not agree consistently enough on the speed direction.",
  "weak-speed-difference":
    "The paired speed difference is too small to suggest an aero tendency.",
  "material-ers-difference":
    "A material ERS deployment difference could explain the straight-line result.",
  "missing-speed": "There is not enough credible speed data for both drivers.",
};

function verdictTone(verdict: keyof typeof VERDICT_COPY): BadgeTone {
  if (verdict === "rival-lower-drag" || verdict === "rival-higher-load") {
    return "sky";
  }
  if (verdict === "inconclusive") return "amber";
  return "zinc";
}

function formatSpeed(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} km/h`;
}

function formatDelta(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} km/h`;
}

function formatContextDelta(
  value: number,
  digits: number,
  suffix: string,
): string {
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}${suffix}`;
}

function lapSuffix(lap: number | undefined): string | undefined {
  return lap == null ? undefined : `Lap ${lap}`;
}

function EvidenceRow({
  label,
  hint,
  focusedValue,
  rivalValue,
  delta,
  focusedSuffix,
  rivalSuffix,
  focusedName,
  rivalName,
  deltaLabel = "Focused − rival",
}: EvidenceRowProps) {
  return (
    <div className="rounded-xl bg-zinc-950/35 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <p className="text-xs font-semibold text-zinc-300">{label}</p>
        <Tooltip text={hint}>
          <span
            tabIndex={0}
            className="inline-flex size-5 items-center justify-center text-zinc-600 transition-colors hover:text-zinc-400 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500"
          >
            <CircleHelp className="size-3" aria-hidden="true" />
          </span>
        </Tooltip>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <p className="break-words text-2xs text-zinc-600">{focusedName}</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {formatSpeed(focusedValue)}
          </p>
          {focusedSuffix && (
            <p className="text-2xs text-zinc-600">{focusedSuffix}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="break-words text-2xs text-zinc-600">{rivalName}</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-zinc-100">
            {formatSpeed(rivalValue)}
          </p>
          {rivalSuffix && (
            <p className="text-2xs text-zinc-600">{rivalSuffix}</p>
          )}
        </div>
        <div className="sm:text-right">
          <p className="text-2xs text-zinc-600">{deltaLabel}</p>
          <p className="font-mono text-sm font-semibold tabular-nums text-sky-300">
            {formatDelta(delta)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SpeedAeroComparison({
  comparison,
  focusedName,
  rivalName,
}: SpeedAeroComparisonProps) {
  const interpretation = comparison?.interpretation;
  const verdict = interpretation?.verdict ?? "unavailable";
  const confidence = interpretation?.confidence;
  const reasons: DisplayReason[] = interpretation?.reasons ?? ["missing-speed"];
  const reasonLines =
    reasons.length > 0
      ? reasons.map((reason) => REASON_COPY[reason])
      : [
          verdict === "no-clear-difference"
            ? "Paired speed and the eligible trap show no meaningful straight-line difference."
            : "Paired speed and the eligible trap agree after the available pace and ERS checks.",
        ];
  const title =
    interpretation?.mode === "straight-line-description"
      ? "Straight-line Comparison"
      : "Speed & Aero";

  return (
    <Card as="section">
      <SectionHeader
        title={title}
        hint={`${focusedName} vs ${rivalName}`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone={verdictTone(verdict)}>{VERDICT_COPY[verdict]}</Badge>
            <Badge tone="zinc">
              {confidence
                ? `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`
                : "Confidence unavailable"}
            </Badge>
          </div>
        }
      />

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {VERDICT_COPY[verdict]}
        {confidence ? `, ${confidence} confidence` : ""}
      </div>

      {comparison ? (
        <div className="space-y-2.5">
          <EvidenceRow
            label="Representative high speed (P80)"
            hint="Uses the same paired lap pool when at least eight comparable laps are available; otherwise each driver's eligible-lap P80 may be shown. The delta is the median of same-lap pairs."
            focusedValue={
              comparison.pairedRepresentative?.focusedKmh ??
              comparison.focused.representativeHighSpeed?.kmh ??
              null
            }
            rivalValue={
              comparison.pairedRepresentative?.rivalKmh ??
              comparison.rival.representativeHighSpeed?.kmh ??
              null
            }
            delta={comparison.pairedMedianDeltaKmh}
            focusedSuffix={
              comparison.pairedRepresentative
                ? `${comparison.comparableLapCount} paired laps`
                : comparison.focused.representativeHighSpeed
                  ? `${comparison.focused.representativeHighSpeed.eligibleLapCount} eligible laps`
                  : undefined
            }
            rivalSuffix={
              comparison.pairedRepresentative
                ? `${comparison.comparableLapCount} paired laps`
                : comparison.rival.representativeHighSpeed
                  ? `${comparison.rival.representativeHighSpeed.eligibleLapCount} eligible laps`
                  : undefined
            }
            focusedName={focusedName}
            rivalName={rivalName}
            deltaLabel="Paired median delta"
          />
          <EvidenceRow
            label="Speed trap"
            hint="Best speed at the circuit's fixed measurement point. A lap is shown only when the record can be attributed safely."
            focusedValue={comparison.focused.speedTrap?.kmh ?? null}
            rivalValue={comparison.rival.speedTrap?.kmh ?? null}
            delta={comparison.speedTrapDeltaKmh}
            focusedSuffix={lapSuffix(comparison.focused.speedTrap?.lap)}
            rivalSuffix={lapSuffix(comparison.rival.speedTrap?.lap)}
            focusedName={focusedName}
            rivalName={rivalName}
          />
          <EvidenceRow
            label="Session peak"
            hint="Highest credible speed observed in the session. It is normally backed by a completed lap; a Limited session-only fallback remains unranked."
            focusedValue={comparison.focused.sessionPeak?.kmh ?? null}
            rivalValue={comparison.rival.sessionPeak?.kmh ?? null}
            delta={comparison.sessionPeakDeltaKmh}
            focusedSuffix={lapSuffix(comparison.focused.sessionPeak?.lap)}
            rivalSuffix={lapSuffix(comparison.rival.sessionPeak?.lap)}
            focusedName={focusedName}
            rivalName={rivalName}
          />
        </div>
      ) : (
        <p className="rounded-xl bg-zinc-950/35 px-3.5 py-4 text-sm text-zinc-400">
          Credible speed profiles are not available for both drivers.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">
            Comparable evidence
          </p>
          <p className="mt-1 font-mono text-sm tabular-nums text-zinc-300">
            {comparison
              ? `${comparison.comparableLapCount} same-lap pair${comparison.comparableLapCount === 1 ? "" : "s"}${comparison.pairedDirectionAgreement != null ? ` · ${Math.round(comparison.pairedDirectionAgreement * 100)}% directional agreement` : ""}`
              : "No comparable lap pairs"}
          </p>
          {comparison && (
            <div className="mt-2 space-y-1 text-xs leading-relaxed text-zinc-500">
              <p>
                Paired ERS deploy:{" "}
                {comparison.pairedErsDeltaMj == null
                  ? "unavailable"
                  : `${formatContextDelta(comparison.pairedErsDeltaMj, 1, " MJ/lap")} focused − rival`}
              </p>
              <p>
                Matched pace:{" "}
                {comparison.matchedSectorDeltasMs == null
                  ? "unavailable"
                  : [
                      comparison.matchedPaceDeltaMs == null
                        ? null
                        : `overall ${formatContextDelta(comparison.matchedPaceDeltaMs / 1000, 3, "s")}`,
                      ...comparison.matchedSectorDeltasMs.map(
                        (delta, index) =>
                          `S${index + 1} ${formatContextDelta(delta / 1000, 3, "s")}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </div>
          )}
        </div>
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">
            Why this verdict
          </p>
          <ul className="mt-1 space-y-1 text-xs leading-relaxed text-zinc-400">
            {reasonLines.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-zinc-600">
        Inference from race telemetry, not recorded setup data. Traffic, tow,
        ERS use, active aero, and driver execution can still affect the result.
      </p>
    </Card>
  );
}
