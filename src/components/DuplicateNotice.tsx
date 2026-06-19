import { Copy, Save } from "lucide-react";
import { HStack } from "./ui/Stack";

interface DuplicateNoticeProps {
  count: number;
  isAutoSave?: boolean;
}

export function DuplicateNotice({ count, isAutoSave }: DuplicateNoticeProps) {
  if (!count && !isAutoSave) return null;

  return (
    <div className="flex flex-col items-center gap-1 text-xs text-zinc-600">
      {isAutoSave && (
        <HStack as="p" justify="center" className="gap-1.5">
          <Save className="h-3 w-3" />
          Recovered from a Pits n' Giggles auto-save
        </HStack>
      )}
      {count > 0 && (
        <HStack as="p" justify="center" className="gap-1.5">
          <Copy className="h-3 w-3" />
          {count} duplicate {count === 1 ? "save" : "saves"} hidden (auto-saves
          & near-duplicates)
        </HStack>
      )}
    </div>
  );
}
