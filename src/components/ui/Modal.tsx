import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../utils/cn";

const TRANSITION_MS = 180;

interface ModalProps {
  // Omit to make the modal non-dismissable (no Escape, no backdrop click, no X).
  onClose?: () => void;
  children: ReactNode;
  // Sizing/extra classes applied to the inner panel.
  className?: string;
}

export function Modal({ onClose, children, className }: ModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Trigger enter transition on next frame so the initial closed state paints first.
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = useCallback(() => {
    if (!onClose) return;
    setOpen(false);
    window.setTimeout(onClose, TRANSITION_MS);
  }, [onClose]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, handleClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-[180ms] ease-out",
        open ? "opacity-100" : "opacity-0",
      )}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative flex w-full flex-col rounded-3xl bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 shadow-2xl ring-1 ring-white/[0.06] transition-all duration-[180ms] ease-out",
          open ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]",
          className,
        )}
      >
        {onClose && (
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 z-10 rounded-lg p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
