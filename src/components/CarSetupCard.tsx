import type { CarSetup } from "../types/telemetry";

interface CarSetupCardProps {
  setup: CarSetup;
}

interface SetupGroup {
  label: string;
  fields: { label: string; value: string }[];
}

function formatValue(key: string, value: number): string {
  // Tyre pressures: 1 decimal + psi
  if (key.includes("tyre-pressure")) return `${value.toFixed(1)} psi`;
  // Fuel load: 1 decimal
  if (key === "fuel-load") return `${value.toFixed(1)} kg`;
  // Camber/toe: 1 decimal with degree sign
  if (key.includes("camber") || key.includes("toe")) return `${value.toFixed(1)}°`;
  // Percentage-style values
  if (key === "on-throttle" || key === "off-throttle" || key === "brake-pressure" || key === "engine-braking")
    return `${value}%`;
  // Brake bias
  if (key === "brake-bias") return `${value}%`;
  return String(value);
}

function buildGroups(setup: CarSetup): SetupGroup[] {
  return [
    {
      label: "Aero",
      fields: [
        { label: "Front Wing", value: formatValue("front-wing", setup["front-wing"]) },
        { label: "Rear Wing", value: formatValue("rear-wing", setup["rear-wing"]) },
      ],
    },
    {
      label: "Suspension",
      fields: [
        { label: "Front Suspension", value: String(setup["front-suspension"]) },
        { label: "Rear Suspension", value: String(setup["rear-suspension"]) },
        { label: "Front Height", value: String(setup["front-suspension-height"]) },
        { label: "Rear Height", value: String(setup["rear-suspension-height"]) },
        { label: "Front ARB", value: String(setup["front-anti-roll-bar"]) },
        { label: "Rear ARB", value: String(setup["rear-anti-roll-bar"]) },
        { label: "Front Camber", value: formatValue("front-camber", setup["front-camber"]) },
        { label: "Rear Camber", value: formatValue("rear-camber", setup["rear-camber"]) },
        { label: "Front Toe", value: formatValue("front-toe", setup["front-toe"]) },
        { label: "Rear Toe", value: formatValue("rear-toe", setup["rear-toe"]) },
      ],
    },
    {
      label: "Brakes",
      fields: [
        { label: "Brake Pressure", value: formatValue("brake-pressure", setup["brake-pressure"]) },
        { label: "Brake Bias", value: formatValue("brake-bias", setup["brake-bias"]) },
      ],
    },
    {
      label: "Differential",
      fields: [
        { label: "On Throttle", value: formatValue("on-throttle", setup["on-throttle"]) },
        { label: "Off Throttle", value: formatValue("off-throttle", setup["off-throttle"]) },
        { label: "Engine Braking", value: formatValue("engine-braking", setup["engine-braking"]) },
      ],
    },
    {
      label: "Tyre Pressures",
      fields: [
        { label: "FL", value: formatValue("tyre-pressure", setup["front-left-tyre-pressure"]) },
        { label: "FR", value: formatValue("tyre-pressure", setup["front-right-tyre-pressure"]) },
        { label: "RL", value: formatValue("tyre-pressure", setup["rear-left-tyre-pressure"]) },
        { label: "RR", value: formatValue("tyre-pressure", setup["rear-right-tyre-pressure"]) },
      ],
    },
    {
      label: "Other",
      fields: [
        { label: "Ballast", value: String(setup.ballast) },
        { label: "Fuel Load", value: formatValue("fuel-load", setup["fuel-load"]) },
      ],
    },
  ];
}

export function CarSetupCard({ setup }: CarSetupCardProps) {
  if (!setup["is-valid"]) return null;

  // Check if all numeric values are zero (invalid/empty setup)
  const allZero = Object.entries(setup).every(([k, v]) => k === "is-valid" || v === 0);
  if (allZero) return null;

  const groups = buildGroups(setup);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-3">Car Setup</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.fields.map((f) => (
                <div key={f.label} className="flex justify-between gap-2 text-xs">
                  <span className="text-zinc-500 truncate">{f.label}</span>
                  <span className="font-mono text-zinc-300 shrink-0">{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
