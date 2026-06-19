import type { ReactNode } from "react";

const DETAIL_VALUE_PATTERN =
  /(?:[+−-]?\d+:\d{2}\.\d{3}|[+−-]?\d+(?:\.\d+)?\s?(?:s\/lap|km\/h|MJ\/lap|kg\/lap|kg|laps?|races?|pts|pos|%|°C)|\b\d+\/\d+\s+(?:laps?|valid)\b|\b\d+\s+(?:green\s+laps?|valid|invalid)\b|\b\d+(?:st|nd|rd|th)(?:\s+of\s+\d+)?\b|\b\d+\s+of\s+\d+\b|\bP\d+(?:\/\d+)?\b|\bS[1-3]\b)/g;

export function highlightDetailValues(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(DETAIL_VALUE_PATTERN)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    parts.push(
      <span
        key={`${value}-${index}`}
        className="font-medium text-zinc-200 tabular-nums"
      >
        {value}
      </span>,
    );
    lastIndex = index + value.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : [text];
}
