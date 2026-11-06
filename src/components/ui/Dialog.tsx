import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../../utils/cn";
import { fadeMotionClass, floatingSurface, popMotionClass } from "./surfaces";

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogClose = DialogPrimitive.Close;

export function DialogPopup({
  className,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "className"> & {
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-tone-1000/50 backdrop-blur-[2px]",
          fadeMotionClass,
        )}
      />
      <DialogPrimitive.Popup
        className={cn(
          floatingSurface,
          popMotionClass,
          "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl outline-none",
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}
