import assert from "node:assert/strict";
import test from "node:test";
import { scoreWords, searchWords } from "../src/components/shell/paletteSearch";
import { getTrackSearchNames } from "../src/utils/tracks";

const find = (names: string[], query: string) =>
  scoreWords(searchWords(...names), searchWords(query));

test("a track is found by its country, aliases, a typo or a half-typed word", () => {
  const sakhir = getTrackSearchNames("Sakhir");
  assert.ok(find(sakhir, "bahrain") > 0);
  assert.ok(find(sakhir, "bahrian") > 0, "one typo");
  assert.ok(find(sakhir, "sakh") > 0, "prefix");
  assert.equal(find(sakhir, "monza"), 0);
  const interlagos = getTrackSearchNames("Interlagos");
  assert.ok(find(interlagos, "brazil") > 0);
  assert.ok(find(interlagos, "interlgos") > 0, "one typo");
});

test("every query word must match, and exact words outrank prefixes and substrings", () => {
  const words = searchWords("CanNibalS_84", "Audi");
  assert.ok(find(["CanNibalS_84"], "nibal") > 0, "inside a gamertag");
  assert.equal(scoreWords(words, searchWords("nibal ferrari")), 0);
  const race = searchWords("Sakhir", "race", "Mon 26 Oct");
  assert.ok(
    scoreWords(race, searchWords("race")) >
      scoreWords(race, searchWords("rac")),
  );
  assert.ok(scoreWords(race, searchWords("sakhir 26 oct")) > 0);
});

test("accents and case do not matter", () => {
  assert.ok(find(["São Paulo"], "sao paulo") > 0);
  assert.ok(find(["Monza"], "MONZA") > 0);
});
