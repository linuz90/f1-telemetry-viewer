import { CircleHelp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildLapSeries,
  compareLaps,
  sectorGaps,
  type LapTip,
  type PreparedLap,
} from "../../analysis/lapTelemetryAnalysis";
import { getTrackCorners } from "../../utils/tracks";
import { SegmentedControl } from "../ui/SegmentedControl";
import { createHoverStore } from "./hoverStore";
import { LapReadout } from "./LapReadout";
import { LapTipsList } from "./LapTipsList";
import { LapTraceCharts } from "./LapTraceCharts";
import { LapTrackMap } from "./LapTrackMap";
import { DEFAULT_PANE_VISIBILITY, PANE_IDS, usePaneVisibility } from "./panes";
import { TracePaneMenu } from "./TracePaneMenu";
import type { SlotLap } from "./types";
import { useLapPlayback } from "./useLapPlayback";

type ZoomPreset = "all" | "s1" | "s2" | "s3";

/**
 * Tips, track map, readout and traces for prepared laps (A first). Owns only
 * view state; mount it with a `key` per selection so zoom and the picked tip
 * reset when the laps change.
 */
export function LapComparisonView({
  slots,
  laps,
  sectorStarts,
  track,
}: {
  slots: readonly SlotLap[];
  laps: readonly PreparedLap[];
  sectorStarts?: [number, number];
  /** Exporter track name, for the outline map. */
  track?: string;
}) {
  const [hoverStore] = useState(createHoverStore);
  const [paneVisibility, setPaneVisibility] = usePaneVisibility();
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [selectedTipId, setSelectedTipId] = useState<string | null>(null);
  // Hovering a row lights up its stretch on the map, and the other way round.
  const [hoveredTipId, setHoveredTipId] = useState<string | null>(null);

  useEffect(() => {
    if (!zoom) return;
    // Skips Esc already claimed by an open menu or dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setSelectedTipId(null);
      setZoom(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoom]);

  const series = useMemo(() => buildLapSeries(laps), [laps]);
  const comparison = useMemo(
    () =>
      laps.length >= 2
        ? compareLaps(laps[0], laps[1], {
            sectorStarts,
            corners: track
              ? getTrackCorners(track, laps[0].trackLengthM)
              : undefined,
          })
        : null,
    [laps, sectorStarts, track],
  );

  // Cars without ERS record a flat or missing battery trace.
  const hasBattery = useMemo(
    () => series.laps.some((lap) => lap.channels.ersMj.some((v) => v > 0)),
    [series],
  );
  const availablePanes = PANE_IDS.filter((id) =>
    id === "gap" ? series.gaps.length > 0 : id === "ers" ? hasBattery : true,
  );

  const trackLengthM = series.trackLengthM;
  // Stable props keep memoized trace panes from redrawing on tip hover.
  const domain = useMemo(
    (): [number, number] => zoom ?? [0, trackLengthM],
    [zoom, trackLengthM],
  );
  const playback = useLapPlayback({
    store: hoverStore,
    grid: series.grid,
    time: series.laps[0].time,
    range: domain,
  });
  // A stored preference can hide every pane these laps can draw, e.g. Gap
  // alone and then a single lap; fall back to the defaults.
  const visibility = availablePanes.some((id) => paneVisibility[id])
    ? paneVisibility
    : DEFAULT_PANE_VISIBILITY;
  const panes = availablePanes.filter((id) => visibility[id]);
  const selectedTip = comparison?.tips.find((tip) => tip.id === selectedTipId);
  const highlight = useMemo(
    () =>
      selectedTip ? { from: selectedTip.from, to: selectedTip.to } : undefined,
    [selectedTip],
  );
  const comparisonSlot = slots[1];
  const comparisonName = !comparisonSlot
    ? ""
    : comparisonSlot.label !== "You"
      ? comparisonSlot.label
      : slots[0].label === "You"
        ? "your other lap"
        : "you";
  const sectorDeltasS = useMemo(
    () =>
      sectorStarts && series.laps.length >= 2
        ? sectorGaps(series, sectorStarts)[0]?.deltasS
        : undefined,
    [series, sectorStarts],
  );

  const selectTip = (tip: LapTip | null) => {
    setSelectedTipId(tip?.id ?? null);
    if (!tip) {
      setZoom(null);
      return;
    }
    const pad = Math.max(60, (tip.to - tip.from) * 0.12);
    setZoom([
      Math.max(0, tip.from - pad),
      Math.min(trackLengthM, tip.to + pad),
    ]);
    // Battery tips are read off the stored-energy trace.
    if (tip.category === "Battery" && !visibility.ers)
      setPaneVisibility({ ...visibility, ers: true });
  };

  const setZoomPreset = (preset: ZoomPreset) => {
    setSelectedTipId(null);
    if (preset === "all" || !sectorStarts) {
      setZoom(null);
      return;
    }
    const bounds: Record<Exclude<ZoomPreset, "all">, [number, number]> = {
      s1: [0, sectorStarts[0]],
      s2: [sectorStarts[0], sectorStarts[1]],
      s3: [sectorStarts[1], trackLengthM],
    };
    setZoom(bounds[preset]);
  };
  const zoomPreset: ZoomPreset | undefined = !zoom
    ? "all"
    : sectorStarts && zoom[0] === 0 && zoom[1] === sectorStarts[0]
      ? "s1"
      : sectorStarts &&
          zoom[0] === sectorStarts[0] &&
          zoom[1] === sectorStarts[1]
        ? "s2"
        : sectorStarts &&
            zoom[0] === sectorStarts[1] &&
            zoom[1] === trackLengthM
          ? "s3"
          : undefined;

  return (
    <>
      {comparison && comparisonSlot && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <LapTipsList
            comparison={comparison}
            comparisonName={comparisonName}
            sectorDeltasS={sectorDeltasS}
            selectedTipId={selectedTipId}
            hoveredTipId={hoveredTipId}
            onSelectTip={selectTip}
            onHoverTip={(tip) => setHoveredTipId(tip?.id ?? null)}
          />
          {track && (
            // top-20 clears the race page's sticky session bar.
            <div className="mx-auto w-full max-w-68 lg:sticky lg:top-20 lg:max-w-none lg:self-start">
              <LapTrackMap
                track={track}
                tips={comparison.tips}
                trackLengthM={trackLengthM}
                speedGrid={series.grid}
                speed={series.laps[0].channels.speed}
                hoverStore={hoverStore}
                cursorColor={slots[0].color}
                activeTipId={hoveredTipId ?? selectedTipId}
                onSelectTip={(tip) =>
                  selectTip(tip?.id === selectedTipId ? null : tip)
                }
                onHoverTip={(tip) => setHoveredTipId(tip?.id ?? null)}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {sectorStarts && (
              <SegmentedControl<ZoomPreset>
                ariaLabel="Zoom"
                size="sm"
                value={zoomPreset ?? ("" as ZoomPreset)}
                onChange={setZoomPreset}
                options={[
                  { value: "all", label: "Full lap" },
                  { value: "s1", label: "S1" },
                  { value: "s2", label: "S2" },
                  { value: "s3", label: "S3" },
                ]}
              />
            )}
            <TracePaneMenu
              available={availablePanes}
              visibility={visibility}
              onChange={setPaneVisibility}
            />
          </div>
          <span
            className="text-zinc-600 transition-colors hover:text-zinc-400"
            title="Drag across the traces to zoom; double-click or Esc to reset"
          >
            <CircleHelp
              className="size-4"
              aria-label="Drag across the traces to zoom; double-click or Esc to reset"
            />
          </span>
        </div>
        <LapReadout
          series={series}
          slots={slots}
          hoverStore={hoverStore}
          playback={playback}
          sectorStarts={sectorStarts}
          track={track}
          showBattery={hasBattery}
        />
        <LapTraceCharts
          series={series}
          slots={slots}
          panes={panes}
          domain={domain}
          onDomainChange={(next) => {
            setSelectedTipId(null);
            setZoom(next);
          }}
          highlight={highlight}
          sectorStarts={sectorStarts}
          hoverStore={hoverStore}
        />
      </div>
    </>
  );
}
