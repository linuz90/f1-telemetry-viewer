import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormRace } from "../../analysis/onlineForm";
import { getTrackCountryCode, getTrackDisplayName } from "../../utils/tracks";
import { sessionSummaryPath } from "../../utils/routes";
import { formatDayLabel } from "../sessions/sessionFormat";
import { useElementWidth } from "./useElementWidth";

// Flag images, not emoji: Windows (where most Pits n' Giggles users race)
// renders flag emoji as letter pairs. Same source as `TrackFlag`.
function flagHref(track: string): string | null {
  const code = getTrackCountryCode(track);
  return code ? `https://flagcdn.com/w40/${code}.png` : null;
}

/**
 * Race by race, grid ○ to finish ●: green stems gained places, red lost them,
 * a white dot is a podium, ✕ a DNF. Hover names the race; click opens it.
 */
export function FormChart({
  races,
  height = 190,
  maxPosition = 22,
  labelEvery = 5,
}: {
  races: FormRace[];
  height?: number;
  maxPosition?: number;
  labelEvery?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);
  const L = 30;
  const R = 6;
  const T = 10;
  const B = 34;
  const step = (width - L - R) / Math.max(1, races.length);
  const x = (i: number) => L + step * (i + 0.5);
  const y = (p: number) => T + ((p - 1) / (maxPosition - 1)) * (height - T - B);
  const hovered = hover != null ? races[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
      >
        {[1, 5, 10, 15, 20]
          .filter((p) => p <= maxPosition)
          .map((p) => (
            <g key={p}>
              <line
                x1={L}
                x2={width - R}
                y1={y(p)}
                y2={y(p)}
                className="stroke-tone-800"
              />
              <text
                x={L - 7}
                y={y(p) + 3.5}
                textAnchor="end"
                className="fill-tone-500 text-[10.5px] tabular-nums"
              >
                P{p}
              </text>
            </g>
          ))}
        {races.map((race, i) => {
          const finishY = race.finish != null ? y(race.finish) : y(maxPosition);
          const tone =
            race.finish == null
              ? "stroke-behind"
              : race.gain == null || race.gain === 0
                ? "stroke-tone-600"
                : race.gain > 0
                  ? "stroke-ahead"
                  : "stroke-behind";
          const showLabel =
            i === 0 || i === races.length - 1 || i % labelEvery === 0;
          return (
            <g
              key={race.session.slug}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onClick={() => navigate(sessionSummaryPath(race.session))}
              className="cursor-pointer"
            >
              <rect
                x={x(i) - step / 2}
                y={T - 6}
                width={step}
                height={height - T - B + 12}
                className={hover === i ? "fill-tone-0/5" : "fill-transparent"}
              />
              {race.grid != null && (
                <line
                  x1={x(i)}
                  x2={x(i)}
                  y1={y(race.grid)}
                  y2={finishY}
                  strokeWidth={3}
                  strokeLinecap="round"
                  className={tone}
                />
              )}
              {race.grid != null && (
                <circle
                  cx={x(i)}
                  cy={y(race.grid)}
                  r={3.6}
                  strokeWidth={1.6}
                  className="fill-tone-900 stroke-tone-400"
                />
              )}
              {race.finish == null ? (
                <text
                  x={x(i)}
                  y={finishY + 4}
                  textAnchor="middle"
                  className="fill-behind text-[14px] font-bold"
                >
                  ×
                </text>
              ) : (
                <circle
                  cx={x(i)}
                  cy={finishY}
                  r={4.6}
                  className={
                    race.finish <= 3 ? "fill-tone-50" : "fill-tone-400"
                  }
                />
              )}
              {flagHref(race.session.track) && (
                <image
                  href={flagHref(race.session.track)!}
                  x={x(i) - 7}
                  y={height - 29}
                  width={14}
                  height={10}
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              {showLabel && (
                <text
                  x={x(i)}
                  y={height - 3}
                  textAnchor="middle"
                  className="fill-tone-500 text-[10px]"
                >
                  {formatDayLabel(race.session.date.split("T")[0]).replace(
                    /^\w+ /,
                    "",
                  )}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hover != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-tone-900 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl ring-1 ring-tone-700"
          style={{
            left: Math.min(width - 180, Math.max(0, x(hover) - 80)),
            top: 0,
          }}
        >
          <b className="font-semibold text-tone-50">
            {getTrackDisplayName(hovered.session.track)}
          </b>{" "}
          <span className="text-tone-400">
            {formatDayLabel(hovered.session.date.split("T")[0])} · P
            {hovered.grid ?? "?"} →{" "}
            {hovered.finish != null ? `P${hovered.finish}` : "DNF"}
          </span>
        </div>
      )}
    </div>
  );
}
