import type { CarSetup } from "../types/telemetry";
import type { TrackStrategySuggestion } from "./trackStrategyTypes";
import { CAR_SETUP_RANGES } from "../constants/setup";

/**
 * Plain-text exports for the copy buttons, in the compact shorthand setup
 * creators share on Discord/YouTube: front-rear pairs in in-game section
 * order, with slider ends written as L/R (geometry) or MIN/MAX (tyres).
 */

type SetupKey = Exclude<keyof CarSetup, "is-valid">;

export function formatSetupText(setup: CarSetup): string {
  const pair = (front: SetupKey, rear: SetupKey) =>
    `${setup[front]}-${setup[rear]}`;
  const geometry = (key: SetupKey) =>
    formatSliderValue(key, setup[key], ["L", "R"], 2);

  return [
    `Aerodynamics: ${pair("front-wing", "rear-wing")}`,
    `Transmission: ${pair("on-throttle", "off-throttle")}`,
    `Suspension Geometry: ${[
      geometry("front-camber"),
      geometry("rear-camber"),
      geometry("front-toe"),
      geometry("rear-toe"),
    ].join("-")}`,
    `Suspension: ${[
      pair("front-suspension", "rear-suspension"),
      pair("front-anti-roll-bar", "rear-anti-roll-bar"),
      pair("front-suspension-height", "rear-suspension-height"),
    ].join(" ")}`,
    `Brake Bias: ${pair("brake-bias", "brake-pressure")}`,
    `Tyres: ${formatAxleTyres(setup, "front-left-tyre-pressure", "front-right-tyre-pressure")}-${formatAxleTyres(setup, "rear-left-tyre-pressure", "rear-right-tyre-pressure")}`,
  ].join("\n");
}

/** Shorthand has one pressure per axle; keep both sides only when they differ. */
function formatAxleTyres(setup: CarSetup, left: SetupKey, right: SetupKey) {
  const format = (key: SetupKey) =>
    formatSliderValue(key, setup[key], ["MIN", "MAX"], 1);
  const leftText = format(left);
  const rightText = format(right);
  return leftText === rightText ? leftText : `${leftText}/${rightText}`;
}

function formatSliderValue(
  key: SetupKey,
  value: number,
  [minLabel, maxLabel]: [string, string],
  decimals: number,
): string {
  const range = CAR_SETUP_RANGES[key];
  // Exports carry float noise (-1.9999999), so compare at display precision.
  const rounded = value.toFixed(decimals);
  if (range) {
    if (rounded === range[0].toFixed(decimals)) return minLabel;
    if (rounded === range[1].toFixed(decimals)) return maxLabel;
  }
  return rounded;
}

export function formatStrategyText(
  strategy: TrackStrategySuggestion,
  totalLaps: number,
  title = "Race strategy",
): string {
  const lines = [
    `${strategy.compounds.join(" → ")} (${formatPitSummary(strategy.pitWindows)})`,
  ];

  let startLap = 1;
  strategy.compounds.forEach((compound, i) => {
    const laps = strategy.stintLaps[i];
    const endLap = startLap + laps - 1;
    const wear = strategy.stintWearPercentages[i];
    const wearLabel =
      Number.isFinite(wear) && wear > 0 ? `, ${Math.round(wear)}% wear` : "";
    lines.push(
      `Stint ${i + 1}: ${compound}, laps ${startLap}–${endLap} (${laps} laps${wearLabel})`,
    );
    startLap = endLap + 1;
  });

  return `${title} · ${totalLaps} laps\n\n${lines.join("\n")}`;
}

function formatPitSummary(
  pitWindows: TrackStrategySuggestion["pitWindows"],
): string {
  if (pitWindows.length === 0) return "No stop";
  const windows = pitWindows.map((w) => `${w.earliest}–${w.latest}`);
  const targets = pitWindows.map((w) => w.target);
  const plural = pitWindows.length > 1 ? "s" : "";
  return `Pit lap${plural} ${windows.join(" & ")}, ideal ${targets.join(" & ")}`;
}
