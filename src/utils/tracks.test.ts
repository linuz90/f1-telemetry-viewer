import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDITIONAL_TRACK_IDS,
  F1_25_TRACK_CALENDAR_IDS,
  F1_26_TRACK_CALENDAR_IDS,
  TRACK_DEFINITIONS,
} from "../constants/tracks";
import { getF1PitLossDefaultMs } from "../constants/pitLoss";
import { buildTrackGroups } from "../components/dashboard/helpers";
import type { SessionSummary } from "../types/telemetry";
import {
  getTrackCountryName,
  getTrackDisplayName,
  getTrackId,
  getTrackLayoutKey,
  isSameTrack,
  isTrackSlugMatch,
  sortTracksByCalendar,
  toTrackSlug,
} from "./tracks";

function legacyTrackSlug(track: string): string {
  return track
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

test("every registered alias resolves to its canonical track metadata", () => {
  const ids = new Set<string>();

  for (const definition of TRACK_DEFINITIONS) {
    assert.equal(
      ids.has(definition.id),
      false,
      `duplicate id ${definition.id}`,
    );
    ids.add(definition.id);

    for (const alias of [
      definition.id,
      definition.displayName,
      definition.location,
      ...definition.aliases,
    ]) {
      assert.equal(getTrackId(alias), definition.id, alias);
      assert.equal(getTrackDisplayName(alias), definition.displayName, alias);
      assert.equal(
        getTrackLayoutKey(alias),
        "layoutKey" in definition ? definition.layoutKey : null,
        alias,
      );
      assert.equal(
        isTrackSlugMatch(alias, legacyTrackSlug(alias)),
        true,
        `legacy route for ${alias}`,
      );
    }
  }

  for (const trackId of [
    ...F1_25_TRACK_CALENDAR_IDS,
    ...F1_26_TRACK_CALENDAR_IDS,
    ...ADDITIONAL_TRACK_IDS,
  ]) {
    assert.equal(getTrackId(trackId), trackId, trackId);
  }
});

test("resolves country, locality, and circuit aliases to one track", () => {
  for (const alias of ["Austria", "Spielberg", "Red Bull Ring"]) {
    assert.equal(getTrackId(alias), "spielberg");
    assert.equal(getTrackDisplayName(alias), "Red Bull Ring");
    assert.equal(getTrackCountryName(alias), "Austria");
  }

  assert.equal(isSameTrack("Austria", "Red Bull Ring"), true);
  assert.equal(toTrackSlug("Austria"), "spielberg");
});

test("legacy and canonical route slugs match the same track", () => {
  assert.equal(isTrackSlugMatch("Austria", "austria"), true);
  assert.equal(isTrackSlugMatch("Austria", "spielberg"), true);
  assert.equal(isTrackSlugMatch("Austria", "red-bull-ring"), true);
  assert.equal(isTrackSlugMatch("Austria Reverse", "austria-reverse"), true);
  assert.equal(isTrackSlugMatch("Austria", "silverstone"), false);
});

test("keeps layout variants distinct while reusing base metadata", () => {
  assert.equal(getTrackId("Austria Reverse"), "spielberg-reverse");
  assert.equal(
    getTrackDisplayName("Austria Reverse"),
    "Red Bull Ring · Reverse",
  );
  assert.equal(getTrackCountryName("Austria Reverse"), "Austria");
  assert.equal(getTrackLayoutKey("Austria Reverse"), "spielberg");
  assert.equal(isSameTrack("Austria", "Austria Reverse"), false);
});

test("normalizes alternate spellings and accented display names", () => {
  assert.equal(getTrackId("Losail"), "lusail");
  assert.equal(getTrackDisplayName("Losail"), "Lusail");
  assert.equal(getTrackDisplayName("Mexico"), "Hermanos Rodríguez");
  assert.equal(getTrackId("Autodromo Hermanos Rodriguez"), "mexico-city");
});

test("canonical ids retain the matching F1 pit-loss defaults", () => {
  const expectedDefaults = {
    spielberg: 19_000,
    "spielberg-reverse": 19_000,
    "marina-bay": 26_000,
    austin: 20_000,
    "mexico-city": 22_000,
    interlagos: 20_000,
    lusail: 25_000,
    "yas-marina": 19_000,
  };

  for (const [trackId, expectedMs] of Object.entries(expectedDefaults)) {
    assert.equal(getF1PitLossDefaultMs(trackId), expectedMs, trackId);
  }

  for (const definition of TRACK_DEFINITIONS) {
    const expectedMs = getF1PitLossDefaultMs(definition.id);
    if (expectedMs == null) continue;

    for (const alias of [
      definition.displayName,
      definition.location,
      ...definition.aliases,
    ]) {
      assert.equal(getF1PitLossDefaultMs(alias), expectedMs, alias);
    }
  }
});

test("group models retain the exporter label for unknown tracks", () => {
  const summary = {
    track: "Fantasy_Circuit",
    formula: "F1",
    gameYear: 26,
  } as SessionSummary;
  const groups = buildTrackGroups([
    { summary, isRace: false, bestLapMs: 0, validLapCount: 0 },
  ]);
  const [group] = Object.values(groups);

  assert.equal(group?.track, "Fantasy_Circuit");
  assert.equal(group?.key.startsWith("fantasy-circuit::"), true);
});

test("does not collapse different circuits in the same country", () => {
  assert.equal(isSameTrack("Catalunya", "Madring"), false);
  assert.equal(isSameTrack("Miami", "COTA"), false);
  assert.equal(isSameTrack("Imola", "Monza"), false);
});

test("calendar sorting uses canonical ids rather than exporter aliases", () => {
  assert.deepEqual(
    sortTracksByCalendar(["Silverstone", "Austria", "Montreal"], "f1-26"),
    ["Montreal", "Austria", "Silverstone"],
  );
});

test("unknown tracks retain a predictable fallback identity and label", () => {
  assert.equal(getTrackId("  Fantasy_Circuit  "), "fantasy-circuit");
  assert.equal(getTrackDisplayName("  Fantasy_Circuit  "), "Fantasy_Circuit");
  assert.equal(getTrackCountryName("Fantasy Circuit"), null);
});
