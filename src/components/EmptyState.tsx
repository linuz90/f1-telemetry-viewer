import { CircleOff } from "lucide-react";
import { HStack } from "./ui/Stack";

interface EmptyStateProps {
  title: string;
  message: string;
}

/**
 * Placeholder shown when a chart section has insufficient data.
 * Compact row with icon, title, and explanation.
 */
export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <HStack className="gap-3 py-1">
      <CircleOff className="size-4 text-zinc-600 shrink-0" />
      <p className="text-sm text-zinc-500">
        <span className="font-medium text-zinc-400">{title}</span>
        {" - "}
        {message}
      </p>
    </HStack>
  );
}
