import type { ComponentProps, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "../utils/cn";

interface TooltipProps {
  text: string;
  children: ReactNode;
  className?: string;
}

export function TooltipProvider({
  delayDuration = 150,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={100}
      {...props}
    />
  );
}

/**
 * Compatibility wrapper around the shadcn/Radix tooltip primitive. Radix owns
 * viewport collision, portal rendering, hover/focus handling, and escape-key
 * dismissal; keeping this tiny wrapper preserves the app's existing
 * `<Tooltip text="...">` call sites.
 */
export function Tooltip({ text, children, className = "" }: TooltipProps) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className={cn("inline-flex items-center", className)}>
            {children}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            align="center"
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-50 max-w-64 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-zinc-300 shadow-lg",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
            )}
          >
            {text}
            <TooltipPrimitive.Arrow className="fill-zinc-800" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipProvider>
  );
}
