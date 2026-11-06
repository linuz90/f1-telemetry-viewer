import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "./Dialog";

interface ModalProps {
  // Omit to make the modal non-dismissable (no Escape, no backdrop click, no X).
  onClose?: () => void;
  /** Standard header; also names the dialog. Omit for a custom layout. */
  title?: ReactNode;
  description?: ReactNode;
  /** Quiet bottom bar for links and credits, like the command palette's. */
  footer?: ReactNode;
  /** The body. With a title, pad it `px-5 pb-5` to line up with the header. */
  children: ReactNode;
  // Sizing/extra classes applied to the inner panel.
  className?: string;
}

export function Modal({
  onClose,
  title,
  description,
  footer,
  children,
  className,
}: ModalProps) {
  const [open, setOpen] = useState(false);
  // Callers mount an already-open modal; Base UI needs an open transition to animate it.
  useEffect(() => setOpen(true), []);

  return (
    <Dialog
      open={open}
      disablePointerDismissal={!onClose}
      onOpenChange={(nextOpen, details) => {
        if (!onClose) details.cancel();
        else setOpen(nextOpen);
      }}
      // Callers unmount on close, so let Base UI finish the exit first.
      onOpenChangeComplete={(nextOpen) => !nextOpen && onClose?.()}
    >
      <DialogPopup className={className}>
        {onClose && (
          <DialogClose
            className="absolute top-3.5 right-3.5 z-10 rounded-md p-1 text-tone-500 transition-colors hover:bg-tone-800 hover:text-tone-200"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogClose>
        )}
        {title && (
          <div className="shrink-0 px-5 pt-4 pb-3 pr-12">
            <DialogTitle className="font-semibold text-tone-50">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-0.5 text-xs text-tone-500">
                {description}
              </DialogDescription>
            )}
          </div>
        )}
        {children}
        {footer && (
          <div className="shrink-0 border-t border-tone-800 px-5 py-2.5 text-xs text-tone-500">
            {footer}
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
