import { Copy } from "lucide-react";

interface DuplicateNoticeProps {
  count: number;
}

export function DuplicateNotice({ count }: DuplicateNoticeProps) {
  if (!count) return null;

  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-600">
      <Copy className="h-3 w-3" />
      {count} duplicate {count === 1 ? "save" : "saves"} hidden (auto-save/manual-save)
    </p>
  );
}
