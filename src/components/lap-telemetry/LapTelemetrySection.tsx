import { ArrowRight, CircleOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  prepareLap,
  type PreparedLap,
} from "../../analysis/lapTelemetryAnalysis";
import {
  bestLapCandidates,
  defaultComparison,
  defaultLapA,
  familyOf,
  isInFamily,
  isSoloSelection,
  LAP_TELEMETRY_ANCHOR,
  lapRefKey,
  LAPS_QUERY_PARAM,
  manifestCandidates,
  MAX_SELECTED_LAPS,
  mergeCandidates,
  parseLapRefs,
  resolvePresets,
  sameLapRef,
  serializeLapRefs,
  type LapCandidate,
  type LapFamily,
} from "../../analysis/lapTelemetrySelection";
import type { TrackSessionKind } from "../../analysis/trackAnalysis";
import { LAP_SLOT_COLORS } from "../../constants/colors";
import {
  useLapRecordingList,
  useLapRecordingManifests,
  useLapTraces,
} from "../../hooks/useLapRecordings";
import { useSessionList } from "../../hooks/useSessionList";
import { msToLapTime } from "../../utils/format";
import { trackPath } from "../../utils/routes";
import { getTrackDisplayName } from "../../utils/tracks";
import { Card } from "../Card";
import { buttonVariants } from "../ui/Button";
import { SectionHeader } from "../ui/SectionHeader";
import { driverLabel, recordingLabel } from "./labels";
import { LapChips } from "./LapChips";
import { LapComparisonView } from "./LapComparisonView";
import { LapPicker } from "./LapPicker";
import { SLOT_NAMES, type SlotLap } from "./types";

export type LapTelemetryScope =
  | {
      kind: "session";
      sessionSlug: string;
      /** Saves dedupe hid behind this session (`SessionSummary.duplicateSlugs`). */
      duplicateSlugs?: readonly string[];
      focusedDriverIndex?: number;
      rivalDriverIndex?: number | null;
    }
  | {
      kind: "track";
      track: string;
      formulaKey: string;
      sessionKind: TrackSessionKind;
    };

function SectionShell({ children }: { children: ReactNode }) {
  return (
    <Card
      as="section"
      id={LAP_TELEMETRY_ANCHOR}
      className="scroll-mt-20 space-y-4"
    >
      {children}
    </Card>
  );
}

/**
 * Lap Telemetry: distance-aligned traces of one or two recorded laps, the
 * time gap, and tips explaining where lap A lost or gained time against B.
 * Mounted on session pages and on each Track Progress tab; only the default
 * laps and the candidate pool differ.
 */
export function LapTelemetrySection({ scope }: { scope: LapTelemetryScope }) {
  const { recordings } = useLapRecordingList();
  const { sessions } = useSessionList();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  const listedSessionSlugs = useMemo(
    () => new Set(sessions.map((s) => s.slug)),
    [sessions],
  );
  const recordingsBySlug = useMemo(
    () => new Map(recordings.map((recording) => [recording.slug, recording])),
    [recordings],
  );
  const ownSlug = scope.kind === "session" ? scope.sessionSlug : undefined;
  const duplicateSlugs =
    scope.kind === "session" ? scope.duplicateSlugs : undefined;
  const ownRecording = ownSlug
    ? recordings.find((recording) => recording.sessionSlug === ownSlug)
    : undefined;
  // Dedupe folds restarted qualifying runs into this session, and their
  // recordings often hold the only complete laps, so they join the pool.
  const sessionRecordings = useMemo(() => {
    if (!ownSlug) return [];
    const hidden = new Set(duplicateSlugs);
    return recordings.filter(
      (recording) =>
        recording.sessionSlug === ownSlug ||
        (recording.completeLapCount > 0 &&
          !!recording.sessionSlug &&
          hidden.has(recording.sessionSlug)),
    );
  }, [duplicateSlugs, ownSlug, recordings]);
  // The recording the picker's "This session" view opens: this save's own
  // when it has complete laps, else the hidden run with the most.
  const sessionRecording = ownRecording?.completeLapCount
    ? ownRecording
    : (sessionRecordings
        .filter((recording) => recording !== ownRecording)
        .sort((a, b) => b.completeLapCount - a.completeLapCount)[0] ??
      ownRecording);
  const family: LapFamily | undefined =
    scope.kind === "session"
      ? sessionRecording && familyOf(sessionRecording)
      : {
          track: scope.track,
          formulaKey: scope.formulaKey,
          kind: scope.sessionKind,
        };

  // Same circuit and formula scope, any session kind (the picker can switch).
  const trackRecordings = useMemo(
    () =>
      family
        ? recordings.filter((recording) =>
            isInFamily(recording, {
              track: family.track,
              formulaKey: family.formulaKey,
            }),
          )
        : [],
    [family?.track, family?.formulaKey, recordings],
  );
  const familyRecordings = useMemo(
    () =>
      family
        ? trackRecordings.filter((recording) => isInFamily(recording, family))
        : [],
    [family?.kind, trackRecordings],
  );
  const familyPool = useMemo(
    () => bestLapCandidates(familyRecordings),
    [familyRecordings],
  );

  const trackSlugs = useMemo(
    () => new Set(trackRecordings.map((r) => r.slug)),
    [trackRecordings],
  );
  // Only this param: other URL state (the track page's race length) must not
  // rebuild the comparison.
  const lapsParam = searchParams.get(LAPS_QUERY_PARAM);
  const urlRefs = useMemo(
    () =>
      parseLapRefs(lapsParam).filter((ref) =>
        trackSlugs.has(ref.recordingSlug),
      ),
    [lapsParam, trackSlugs],
  );
  const solo = isSoloSelection(lapsParam);
  const manifestSlugs = useMemo(
    () => [
      ...new Set([
        ...sessionRecordings.map((recording) => recording.slug),
        ...urlRefs.map((ref) => ref.recordingSlug),
      ]),
    ],
    [sessionRecordings, urlRefs],
  );
  const { manifests, failed: failedManifests } =
    useLapRecordingManifests(manifestSlugs);
  const sessionManifest = sessionRecording
    ? manifests.get(sessionRecording.slug)
    : undefined;

  const candidateByKey = useMemo(() => {
    const fromManifests = [...manifests.values()].flatMap((manifest) => {
      const recording = recordingsBySlug.get(manifest.slug);
      return recording ? manifestCandidates(manifest, recording) : [];
    });
    return new Map(
      mergeCandidates(familyPool, fromManifests).map((candidate) => [
        lapRefKey(candidate.ref),
        candidate,
      ]),
    );
  }, [familyPool, manifests, recordingsBySlug]);

  const sessionPool = useMemo(() => {
    const slugs = new Set(sessionRecordings.map((recording) => recording.slug));
    return [...candidateByKey.values()].filter((c) =>
      slugs.has(c.ref.recordingSlug),
    );
  }, [candidateByKey, sessionRecordings]);
  // Default to this save's own laps; without any, the fastest hidden run's.
  const defaultRecordingSlug = ownRecording?.completeLapCount
    ? ownRecording.slug
    : undefined;

  const focusedDriverIndex =
    scope.kind === "session" ? scope.focusedDriverIndex : undefined;
  const rivalDriverIndex =
    scope.kind === "session" ? scope.rivalDriverIndex : undefined;
  const urlPending = urlRefs.some(
    (ref) =>
      !candidateByKey.has(lapRefKey(ref)) &&
      !manifests.has(ref.recordingSlug) &&
      !failedManifests.has(ref.recordingSlug),
  );
  const selected = useMemo((): LapCandidate[] => {
    // Wait for the manifests the URL names rather than flashing default laps.
    if (urlPending) return [];
    const fromUrl = urlRefs
      .map((ref) => candidateByKey.get(lapRefKey(ref)))
      .filter((candidate): candidate is LapCandidate => !!candidate);
    const a =
      fromUrl[0] &&
      urlRefs[0] &&
      lapRefKey(fromUrl[0].ref) === lapRefKey(urlRefs[0])
        ? fromUrl[0]
        : scope.kind === "session"
          ? defaultLapA(sessionPool, {
              recordingSlug: defaultRecordingSlug,
              driverIndex: focusedDriverIndex,
            })
          : defaultLapA(familyPool, {});
    if (!a) return [];
    let comparisons = fromUrl
      .filter((candidate) => lapRefKey(candidate.ref) !== lapRefKey(a.ref))
      .slice(0, MAX_SELECTED_LAPS - 1);
    if (comparisons.length === 0 && !solo) {
      const fallback = defaultComparison(
        a,
        scope.kind === "session" ? sessionPool : familyPool,
        {
          rivalDriverIndex,
        },
      );
      comparisons = fallback ? [fallback] : [];
    }
    return [a, ...comparisons];
  }, [
    candidateByKey,
    familyPool,
    focusedDriverIndex,
    rivalDriverIndex,
    scope.kind,
    sessionPool,
    defaultRecordingSlug,
    urlPending,
    urlRefs,
    solo,
  ]);
  const selectionKey = selected
    .map((candidate) => lapRefKey(candidate.ref))
    .join(",");

  // Selected laps' manifests carry track length, sectors and weather.
  const { manifests: selectedManifests, failed: failedSelectedManifests } =
    useLapRecordingManifests(
      useMemo(
        () => [...new Set(selected.map((c) => c.ref.recordingSlug))],
        [selected],
      ),
    );
  const traces = useLapTraces(
    useMemo(() => selected.map((c) => c.ref), [selected]),
  );

  // "failed" shows the load error instead of a skeleton that never ends.
  const prepared = useMemo((): PreparedLap[] | "failed" | null => {
    if (selected.length === 0) return null;
    const laps: PreparedLap[] = [];
    for (const [index, candidate] of selected.entries()) {
      if (
        traces[index]?.error ||
        failedSelectedManifests.has(candidate.ref.recordingSlug)
      ) {
        return "failed";
      }
      const trace = traces[index]?.trace;
      const manifest = selectedManifests.get(candidate.ref.recordingSlug);
      if (!trace || !manifest) return null;
      try {
        laps.push(
          prepareLap(
            trace,
            {
              key: lapRefKey(candidate.ref),
              driverName: candidate.driverName,
              team: candidate.team,
              isPlayer: candidate.isPlayer,
              sessionType: candidate.recording.sessionType,
              lapNumber: candidate.ref.lapNumber,
              lapTimeMs: candidate.lapTimeMs,
              compound: candidate.compound,
              weather: manifest.weather,
            },
            manifest.trackLengthM,
          ),
        );
      } catch {
        return "failed";
      }
    }
    return laps;
  }, [selected, traces, selectedManifests, failedSelectedManifests]);
  const preparedLaps = prepared === "failed" ? null : prepared;

  const aManifest = selected[0]
    ? selectedManifests.get(selected[0].ref.recordingSlug)
    : undefined;
  // Scroll once per navigation, after the section has laps to show: on a
  // reload or shared link the list loads after the first render.
  const scrolledFor = useRef<string | null>(null);
  const hasLaps = !!preparedLaps;
  useEffect(() => {
    if (
      location.hash === `#${LAP_TELEMETRY_ANCHOR}` &&
      hasLaps &&
      scrolledFor.current !== location.key
    ) {
      scrolledFor.current = location.key;
      document
        .getElementById(LAP_TELEMETRY_ANCHOR)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hasLaps, location.key, location.hash]);

  const presetPool = useMemo(
    () => mergeCandidates(familyPool, sessionPool),
    [familyPool, sessionPool],
  );
  const presets = useMemo(
    () => (selected[0] ? resolvePresets(selected[0].ref, presetPool) : []),
    [selected, presetPool],
  );

  const ownRecordingSlug = ownRecording?.slug;
  const slots = useMemo(
    (): SlotLap[] =>
      selected.map((candidate, index) => ({
        slot: SLOT_NAMES[index],
        key: lapRefKey(candidate.ref),
        color: LAP_SLOT_COLORS[index],
        label: driverLabel(candidate.driverName, candidate.isPlayer),
        candidate,
        detail: [
          // "Session best" says more about a comparison lap than where it is from.
          index > 0
            ? presets.find(
                (preset) =>
                  preset.candidate &&
                  sameLapRef(preset.candidate.ref, candidate.ref),
              )?.label
            : undefined,
          candidate.recording.slug === ownRecordingSlug
            ? undefined
            : recordingLabel(candidate.recording),
          `Lap ${candidate.ref.lapNumber}`,
          candidate.compound,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [selected, presets, ownRecordingSlug],
  );

  const writeSelection = (next: readonly LapCandidate[]) => {
    // Built by hand so refs stay readable (`slug~21~1,slug~21~1`):
    // URLSearchParams would percent-encode every `~` and `,`. Dropping the
    // hash keeps an entry-point link from scrolling again on every change.
    const params = new URLSearchParams(location.search);
    params.delete(LAPS_QUERY_PARAM);
    const rest = params.toString();
    const laps = `${LAPS_QUERY_PARAM}=${serializeLapRefs(next.map((candidate) => candidate.ref))}`;
    navigate(
      {
        pathname: location.pathname,
        search: `?${rest ? `${rest}&` : ""}${laps}`,
        hash: "",
      },
      { replace: true, preventScrollReset: true },
    );
  };

  if (scope.kind === "session" && !sessionRecording) return null;
  // The track pool holds valid, pit-free bests only; a family whose complete
  // laps are all invalid has nothing to default to. URL refs count only when
  // they name a recording here, so a shared link never shows an empty card.
  if (
    scope.kind === "track" &&
    familyPool.length === 0 &&
    urlRefs.length === 0
  ) {
    return null;
  }
  if (
    scope.kind === "session" &&
    sessionRecording &&
    sessionRecording.completeLapCount === 0
  ) {
    // Say which lap was cut short and point at runs that can be compared,
    // so the section is not a dead end while the beta drops partial laps.
    const driver =
      sessionRecording.drivers.find((d) => d.index === focusedDriverIndex) ??
      sessionRecording.drivers.find(
        (d) => d.index === sessionRecording.playerIndex,
      );
    const partial = driver?.fasterIncomplete;
    const whose = driver
      ? driverLabel(driver.name, driver.index === sessionRecording.playerIndex)
      : "";
    const elsewhere = familyRecordings.some(
      (recording) =>
        recording.slug !== sessionRecording.slug &&
        recording.completeLapCount > 0,
    );
    return (
      <SectionShell>
        <SectionHeader
          title="Lap Telemetry"
          hint="Recorded laps, aligned by distance"
        />
        <div className="flex items-start gap-3">
          <CircleOff className="mt-0.5 size-4 shrink-0 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            This session was recorded, but no lap start to finish
            {partial ? (
              <>
                : {whose === "You" ? "your" : `${whose}'s`}{" "}
                <span className="font-mono text-zinc-200">
                  {msToLapTime(partial.lapTimeMs)}
                </span>{" "}
                on lap {partial.lapNumber} is incomplete ({partial.reason})
              </>
            ) : null}
            . The Pits n' Giggles beta still cuts some laps short, so there is
            nothing to compare here.
          </p>
        </div>
        {elsewhere && family && (
          <Link
            to={trackPath(family.formulaKey, family.track, family.kind)}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Compare complete laps from other runs at{" "}
            {getTrackDisplayName(family.track)}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </SectionShell>
    );
  }

  const fastestKey = slots.reduce<SlotLap | undefined>(
    (best, slot) =>
      !best || slot.candidate.lapTimeMs < best.candidate.lapTimeMs
        ? slot
        : best,
    undefined,
  )?.key;
  const traceFailed = prepared === "failed";
  const loading = !prepared && (urlPending || selected.length > 0);

  const pickLap = (candidate: LapCandidate) => {
    if (pickerSlot === null) return;
    const next = [...selected];
    const existing = next.findIndex(
      (entry) => lapRefKey(entry.ref) === lapRefKey(candidate.ref),
    );
    if (existing >= 0 && existing !== pickerSlot && pickerSlot < next.length) {
      // Picking a lap already in another slot swaps the two.
      [next[existing], next[pickerSlot]] = [next[pickerSlot], next[existing]];
    } else if (existing < 0) {
      next[pickerSlot] = candidate;
    }
    // Re-adding a selected lap changes nothing; writing it would mark solo.
    if (existing < 0 || pickerSlot < selected.length) {
      writeSelection(next.slice(0, MAX_SELECTED_LAPS));
    }
    setPickerSlot(null);
  };

  const trackName = getTrackDisplayName(family?.track ?? "");
  const canAdd =
    slots.length > 0 &&
    slots.length < MAX_SELECTED_LAPS &&
    candidateByKey.size > slots.length;

  return (
    <SectionShell>
      <SectionHeader
        title="Lap Telemetry"
        hint="Recorded laps, aligned by distance"
      />

      <LapChips
        slots={slots}
        fastestKey={slots.length > 1 ? fastestKey : undefined}
        canAdd={canAdd}
        onOpenPicker={setPickerSlot}
        // Removing A promotes B; the lone lap is written as solo so the
        // default comparison does not come straight back.
        onRemove={(index) =>
          writeSelection(selected.filter((_, i) => i !== index))
        }
      />

      {slots.length === 1 && !canAdd && (
        <p className="text-sm text-zinc-500">
          No other complete lap is recorded here to compare against yet.
        </p>
      )}
      {traceFailed && (
        <p className="text-sm text-zinc-500">
          Could not load the recorded traces for these laps.
        </p>
      )}
      {loading && (
        <div
          role="status"
          className="h-64 animate-pulse rounded-xl bg-zinc-800/30"
          aria-label="Loading lap traces"
        />
      )}

      {preparedLaps && (
        <LapComparisonView
          key={selectionKey}
          slots={slots}
          laps={preparedLaps}
          sectorStarts={aManifest?.sectorStartsM}
          track={family?.track}
        />
      )}

      {pickerSlot !== null && family && (
        <LapPicker
          slotName={SLOT_NAMES[Math.min(pickerSlot, SLOT_NAMES.length - 1)]}
          slotsByKey={new Map(slots.map((slot) => [slot.key, slot.slot]))}
          trackName={trackName}
          kind={family.kind}
          sessionRecording={sessionRecording}
          sessionManifest={sessionManifest}
          trackRecordings={trackRecordings}
          listedSessionSlugs={listedSessionSlugs}
          presets={pickerSlot > 0 ? presets : []}
          onPick={pickLap}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </SectionShell>
  );
}
