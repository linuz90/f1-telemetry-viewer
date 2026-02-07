import type { WeatherForecastSample } from "../types/telemetry";

interface WeatherTimelineProps {
  forecastSamples: WeatherForecastSample[];
}

const WEATHER_COLORS: Record<string, string> = {
  Clear: "#38bdf8",       // sky-400
  Overcast: "#71717a",    // zinc-500
  "Light Rain": "#60a5fa", // blue-400
  "Heavy Rain": "#1d4ed8", // blue-700
  Storm: "#a855f7",       // purple-500
};

interface Segment {
  weather: string;
  startOffset: number;
  endOffset: number;
}

export function WeatherTimeline({ forecastSamples }: WeatherTimelineProps) {
  if (!forecastSamples.length) return null;

  // Check if weather is constant — skip rendering if so
  const allSameWeather = forecastSamples.every(
    (s) => s.weather === forecastSamples[0].weather,
  );
  if (allSameWeather) return null;

  // Group consecutive same-weather samples into segments
  const segments: Segment[] = [];
  for (const sample of forecastSamples) {
    const last = segments[segments.length - 1];
    if (last && last.weather === sample.weather) {
      last.endOffset = sample["time-offset"];
    } else {
      segments.push({
        weather: sample.weather,
        startOffset: sample["time-offset"],
        endOffset: sample["time-offset"],
      });
    }
  }

  const minOffset = forecastSamples[0]["time-offset"];
  const maxOffset = forecastSamples[forecastSamples.length - 1]["time-offset"];
  const totalRange = maxOffset - minOffset || 1;

  // Temperature ranges
  const trackTemps = forecastSamples.map((s) => s["track-temperature"]);
  const airTemps = forecastSamples.map((s) => s["air-temperature"]);
  const trackMin = Math.min(...trackTemps);
  const trackMax = Math.max(...trackTemps);
  const airMin = Math.min(...airTemps);
  const airMax = Math.max(...airTemps);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-300 mb-2">
        Weather Forecast
      </h3>
      <div className="flex h-6 rounded-lg overflow-hidden gap-0.5">
        {segments.map((seg, i) => {
          // Width proportional to time range covered
          const segStart = seg.startOffset - minOffset;
          const segEnd = seg.endOffset - minOffset;
          // Add some padding so single-sample segments are visible
          const segRange = Math.max(segEnd - segStart, totalRange * 0.05);
          const widthPct = (segRange / totalRange) * 100;
          const color = WEATHER_COLORS[seg.weather] ?? "#71717a";

          return (
            <div
              key={i}
              className="flex items-center justify-center text-[10px] font-semibold text-white/80"
              style={{
                width: `${widthPct}%`,
                backgroundColor: color,
                minWidth: "30px",
              }}
              title={seg.weather}
            >
              <span className="truncate px-1">{seg.weather}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-1.5 text-[10px] text-zinc-500">
        <span>
          Track: {trackMin === trackMax ? `${trackMin}°C` : `${trackMin}–${trackMax}°C`}
        </span>
        <span>
          Air: {airMin === airMax ? `${airMin}°C` : `${airMin}–${airMax}°C`}
        </span>
      </div>
    </div>
  );
}
