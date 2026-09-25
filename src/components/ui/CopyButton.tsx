import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../utils/cn";
import { Tooltip } from "../Tooltip";

const COPIED_RESET_MS = 1500;

/**
 * Small icon button that copies plain text. `getText` runs on click so callers
 * don't format text on every render. Radix closes the tooltip on press, so the
 * confirmation is the check icon swap rather than tooltip copy.
 */
export function CopyButton({
  getText,
  label,
  className,
}: {
  getText: () => string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function handleClick() {
    const ok = await copyToClipboard(getText());
    if (!ok) return;
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }

  const Icon = copied ? Check : Copy;

  return (
    <Tooltip text={label}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-500",
          copied ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-300",
          className,
        )}
        aria-label={copied ? "Copied" : label}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The async Clipboard API is unavailable outside secure contexts, e.g. a
    // self-hosted viewer opened over plain http on the LAN.
    return copyWithTextarea(text);
  }
}

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
