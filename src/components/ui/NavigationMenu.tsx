import { NavigationMenu as BaseNavigationMenu } from "@base-ui/react/navigation-menu";
import type { ComponentProps } from "react";
import { cn } from "../../utils/cn";
import { menuSurfaceClass, popMotionClass } from "./surfaces";

// NavigationMenu owns hover intent and the focus path through rich link panels.
export const NavigationMenu = BaseNavigationMenu.Root;
export const NavigationMenuList = BaseNavigationMenu.List;
export const NavigationMenuItem = BaseNavigationMenu.Item;
export const NavigationMenuTrigger = BaseNavigationMenu.Trigger;
export const NavigationMenuContent = BaseNavigationMenu.Content;

export function NavigationMenuLink({
  className,
  ...props
}: Omit<ComponentProps<typeof BaseNavigationMenu.Link>, "className"> & {
  className?: string;
}) {
  return (
    <BaseNavigationMenu.Link
      closeOnClick
      className={cn(
        "outline-none focus-visible:ring-1 focus-visible:ring-tone-500",
        className,
      )}
      {...props}
    />
  );
}

export function NavigationMenuPopup({
  anchor,
}: Pick<ComponentProps<typeof BaseNavigationMenu.Positioner>, "anchor">) {
  return (
    <BaseNavigationMenu.Portal>
      <BaseNavigationMenu.Positioner
        anchor={anchor}
        sideOffset={6}
        align="start"
        collisionPadding={8}
        className="z-50 outline-none max-sm:hidden"
      >
        <BaseNavigationMenu.Popup
          className={cn(
            menuSurfaceClass,
            popMotionClass,
            "max-h-(--available-height) max-w-[calc(100vw-1rem)] overflow-y-auto text-sm outline-none",
          )}
        >
          <BaseNavigationMenu.Viewport />
        </BaseNavigationMenu.Popup>
      </BaseNavigationMenu.Positioner>
    </BaseNavigationMenu.Portal>
  );
}
