import { Copy } from "lucide-react";
import { HStack } from "./ui/Stack";

interface DuplicateNoticeProps {
  count: number;
}

export function DuplicateNotice({ count }: DuplicateNoticeProps) {
  if (!count) return null;

  return (
    <HStack as="p" justify="center" className="gap-1.5 text-xs text-zinc-600">
      <Copy className="h-3 w-3" />
      {count} duplicate {count === 1 ? "save" : "saves"} hidden (auto-saves & near-duplicates)
    </HStack>
  );
}
