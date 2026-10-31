import {
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { popMotionClass } from "./ui/surfaces";
import { cn } from "../utils/cn";

interface TooltipProps {
  text: string;
  children: ReactNode;
  className?: string;
}

/** Mounted once at the root: tooltips share its delay, and once one is open,
 *  moving to the next opens it without waiting again (`timeout`). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={150} timeout={100}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ text, children, className = "" }: TooltipProps) {
  const trigger: ReactElement =
    isValidElement<{ className?: string }>(children) &&
    children.type !== Fragment ? (
      cloneElement(children, {
        className: cn(children.props.className, className),
      })
    ) : (
      <span className={cn("inline-flex items-center", className)}>
        {children}
      </span>
    );

  return (
    <TooltipPrimitive.Root>
      {/* Base UI tooltips are visual-only; keep the hint available to screen readers. */}
      <TooltipPrimitive.Trigger render={trigger} aria-description={text} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <TooltipPrimitive.Popup
            className={cn(
              "max-w-64 rounded-md border border-tone-700 bg-tone-800 px-2.5 py-1.5 text-left text-xs font-normal leading-snug text-tone-300 shadow-lg",
              popMotionClass,
            )}
          >
            {text}
            <TooltipPrimitive.Arrow className="data-[side=top]:bottom-[-5px] data-[side=bottom]:top-[-5px] data-[side=bottom]:rotate-180 data-[side=left]:right-[-7px] data-[side=left]:-rotate-90 data-[side=right]:left-[-7px] data-[side=right]:rotate-90">
              <svg
                width="10"
                height="5"
                viewBox="0 0 10 5"
                aria-hidden="true"
                className="fill-tone-800"
              >
                <path d="M0 0H10L5 5Z" />
              </svg>
            </TooltipPrimitive.Arrow>
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
