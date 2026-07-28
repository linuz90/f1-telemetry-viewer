import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FlagTriangleRight,
} from "lucide-react";
import { Button } from "./ui/Button";
import type { PillSelectOption, PillSelectValue } from "./ui/PillSelect";

interface RaceControlLapNavigatorProps {
  value: PillSelectValue;
  options: readonly PillSelectOption[];
  onChange: (value: string) => void;
}

export function RaceControlLapNavigator({
  value,
  options,
  onChange,
}: RaceControlLapNavigatorProps) {
  const lapValues = options.map((option) => String(option.value));
  const selectedIndex = lapValues.indexOf(String(value));
  const previousLap =
    selectedIndex > 0 ? lapValues[selectedIndex - 1] : undefined;
  const nextLap =
    selectedIndex >= 0 && selectedIndex < lapValues.length - 1
      ? lapValues[selectedIndex + 1]
      : undefined;

  return (
    <div
      role="group"
      aria-label="Navigate race-control laps"
      className="grid h-7.5 w-full min-w-0 grid-cols-[1.875rem_minmax(0,1fr)_1.875rem] overflow-hidden rounded-lg bg-zinc-900/70 ring-1 ring-inset ring-zinc-800/80 transition-shadow hover:ring-zinc-700 focus-within:ring-2 focus-within:ring-zinc-600/70"
    >
      <Button
        size="icon"
        variant="ghost"
        className="size-auto rounded-none border-r border-zinc-800/70 p-0 disabled:opacity-25"
        disabled={!previousLap}
        onClick={() => previousLap && onChange(previousLap)}
        aria-label="Previous race-control group"
        title="Previous group"
      >
        <ChevronLeft aria-hidden="true" className="size-3.5" />
      </Button>
      <span className="relative flex min-w-0 items-center">
        <FlagTriangleRight
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 size-3 text-zinc-500"
        />
        <select
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Jump to race-control lap"
          className="h-full w-full min-w-0 appearance-none bg-transparent pl-7 pr-7 text-xs font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800/30 focus:bg-zinc-800/40"
        >
          {options.map((option) => (
            <option
              key={String(option.value)}
              value={String(option.value)}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 size-3 text-zinc-500"
        />
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-auto rounded-none border-l border-zinc-800/70 p-0 disabled:opacity-25"
        disabled={!nextLap}
        onClick={() => nextLap && onChange(nextLap)}
        aria-label="Next race-control group"
        title="Next group"
      >
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}
