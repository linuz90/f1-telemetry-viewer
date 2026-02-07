import type { CarSetup } from "../types/telemetry";

interface CarSetupCardProps {
  setup: CarSetup;
}

// Min/max ranges for F1 setup parameters (based on F1 24)
const RANGES: Record<string, [number, number]> = {
  "front-wing": [0, 50],
  "rear-wing": [0, 50],
  "on-throttle": [50, 100],
  "off-throttle": [50, 100],
  "front-camber": [-3.5, -2.5],
  "rear-camber": [-2.0, -1.0],
  "front-toe": [0.0, 0.5],
  "rear-toe": [0.0, 0.5],
  "front-suspension": [1, 41],
  "rear-suspension": [1, 41],
  "front-anti-roll-bar": [1, 21],
  "rear-anti-roll-bar": [1, 21],
  "front-suspension-height": [1, 50],
  "rear-suspension-height": [1, 75],
  "brake-pressure": [80, 100],
  "brake-bias": [50, 70],
  "front-left-tyre-pressure": [21.0, 30.0],
  "front-right-tyre-pressure": [21.0, 30.0],
  "rear-left-tyre-pressure": [19.5, 27.0],
  "rear-right-tyre-pressure": [19.5, 27.0],
};

function getRangePercent(key: string, value: number): number {
  const range = RANGES[key];
  if (!range) return 50;
  const [min, max] = range;
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function formatValue(key: string, value: number): string {
  if (key.includes("tyre-pressure")) return value.toFixed(1);
  if (key.includes("camber") || key.includes("toe"))
    return `${value.toFixed(1)}°`;
  if (
    [
      "on-throttle",
      "off-throttle",
      "brake-pressure",
      "brake-bias",
    ].includes(key)
  )
    return `${value}%`;
  return String(value);
}

function RangeBar({ setupKey, value }: { setupKey: string; value: number }) {
  const pct = getRangePercent(setupKey, value);
  return (
    <div className="h-1.5 bg-zinc-800 rounded-full flex-1 min-w-[48px]">
      <div
        className="h-full rounded-full bg-blue-500/50"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SetupRow({
  label,
  setupKey,
  value,
}: {
  label: string;
  setupKey: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-zinc-500 w-20 shrink-0 truncate">{label}</span>
      <RangeBar setupKey={setupKey} value={value} />
      <span className="font-mono text-zinc-300 w-14 text-right shrink-0">
        {formatValue(setupKey, value)}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-2">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function TyrePressureCell({
  label,
  setupKey,
  value,
}: {
  label: string;
  setupKey: string;
  value: number;
}) {
  const pct = getRangePercent(setupKey, value);
  return (
    <div className="flex flex-col items-center gap-1 py-2.5 px-3 rounded-lg bg-zinc-800/40">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono text-sm font-medium text-zinc-200">
        {value.toFixed(1)}
      </span>
      <div className="w-full h-1 bg-zinc-700/60 rounded-full">
        <div
          className="h-full rounded-full bg-blue-500/50"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function CarSetupCard({ setup }: CarSetupCardProps) {
  if (!setup["is-valid"]) return null;

  const allZero = Object.entries(setup).every(
    ([k, v]) => k === "is-valid" || v === 0,
  );
  if (allZero) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-4">Car Setup</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
        {/* Column 1: Aero + Transmission + Brakes */}
        <div className="space-y-5">
          <Section title="Aerodynamics">
            <SetupRow
              label="Front Wing"
              setupKey="front-wing"
              value={setup["front-wing"]}
            />
            <SetupRow
              label="Rear Wing"
              setupKey="rear-wing"
              value={setup["rear-wing"]}
            />
          </Section>

          <Section title="Transmission">
            <SetupRow
              label="On Throttle"
              setupKey="on-throttle"
              value={setup["on-throttle"]}
            />
            <SetupRow
              label="Off Throttle"
              setupKey="off-throttle"
              value={setup["off-throttle"]}
            />
          </Section>

          <Section title="Brakes">
            <SetupRow
              label="Pressure"
              setupKey="brake-pressure"
              value={setup["brake-pressure"]}
            />
            <SetupRow
              label="Bias"
              setupKey="brake-bias"
              value={setup["brake-bias"]}
            />
          </Section>
        </div>

        {/* Column 2: Suspension + Geometry */}
        <div className="space-y-5">
          <Section title="Suspension">
            <SetupRow
              label="Spring F"
              setupKey="front-suspension"
              value={setup["front-suspension"]}
            />
            <SetupRow
              label="Spring R"
              setupKey="rear-suspension"
              value={setup["rear-suspension"]}
            />
            <SetupRow
              label="ARB F"
              setupKey="front-anti-roll-bar"
              value={setup["front-anti-roll-bar"]}
            />
            <SetupRow
              label="ARB R"
              setupKey="rear-anti-roll-bar"
              value={setup["rear-anti-roll-bar"]}
            />
            <SetupRow
              label="Height F"
              setupKey="front-suspension-height"
              value={setup["front-suspension-height"]}
            />
            <SetupRow
              label="Height R"
              setupKey="rear-suspension-height"
              value={setup["rear-suspension-height"]}
            />
          </Section>

          <Section title="Geometry">
            <SetupRow
              label="Camber F"
              setupKey="front-camber"
              value={setup["front-camber"]}
            />
            <SetupRow
              label="Camber R"
              setupKey="rear-camber"
              value={setup["rear-camber"]}
            />
            <SetupRow
              label="Toe F"
              setupKey="front-toe"
              value={setup["front-toe"]}
            />
            <SetupRow
              label="Toe R"
              setupKey="rear-toe"
              value={setup["rear-toe"]}
            />
          </Section>
        </div>

        {/* Column 3: Tyre Pressures + Other */}
        <div className="space-y-5">
          <Section title="Tyre Pressures (psi)">
            <div className="grid grid-cols-2 gap-1.5">
              <TyrePressureCell
                label="FL"
                setupKey="front-left-tyre-pressure"
                value={setup["front-left-tyre-pressure"]}
              />
              <TyrePressureCell
                label="FR"
                setupKey="front-right-tyre-pressure"
                value={setup["front-right-tyre-pressure"]}
              />
              <TyrePressureCell
                label="RL"
                setupKey="rear-left-tyre-pressure"
                value={setup["rear-left-tyre-pressure"]}
              />
              <TyrePressureCell
                label="RR"
                setupKey="rear-right-tyre-pressure"
                value={setup["rear-right-tyre-pressure"]}
              />
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
