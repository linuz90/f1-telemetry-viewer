import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../utils/cn";
import { menuItemClass, menuSurfaceClass, popMotionClass } from "./surfaces";

export const Menu = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;
export const MenuGroup = BaseMenu.Group;
export const MenuRadioGroup = BaseMenu.RadioGroup;

type StyledProps<T> = Omit<T, "className"> & { className?: string };

type MenuPopupProps = StyledProps<ComponentProps<typeof BaseMenu.Popup>> &
  Pick<
    ComponentProps<typeof BaseMenu.Positioner>,
    "side" | "align" | "sideOffset"
  >;

export function MenuPopup({
  side = "bottom",
  align = "start",
  sideOffset = 6,
  className,
  ...props
}: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="z-50 outline-none"
      >
        <BaseMenu.Popup
          className={cn(
            menuSurfaceClass,
            popMotionClass,
            "max-h-(--available-height) max-w-[calc(100vw-1rem)] overflow-y-auto outline-none",
            className,
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuItem({
  className,
  ...props
}: StyledProps<ComponentProps<typeof BaseMenu.Item>>) {
  return <BaseMenu.Item className={cn(menuItemClass, className)} {...props} />;
}

export function MenuLinkItem({
  className,
  ...props
}: StyledProps<ComponentProps<typeof BaseMenu.LinkItem>>) {
  return (
    <BaseMenu.LinkItem
      closeOnClick
      className={cn(menuItemClass, className)}
      {...props}
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  ...props
}: StyledProps<ComponentProps<typeof BaseMenu.CheckboxItem>>) {
  return (
    <BaseMenu.CheckboxItem
      className={cn(menuItemClass, "text-xs text-tone-300", className)}
      {...props}
    >
      <span className="grid size-3.5 shrink-0 place-items-center rounded-sm border border-tone-700 in-data-checked:border-tone-500 in-data-checked:bg-tone-600">
        <BaseMenu.CheckboxItemIndicator>
          <Check aria-hidden className="size-2 text-tone-200" />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      <span className="truncate">{children}</span>
    </BaseMenu.CheckboxItem>
  );
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: StyledProps<ComponentProps<typeof BaseMenu.RadioItem>>) {
  return (
    <BaseMenu.RadioItem
      closeOnClick
      className={cn(menuItemClass, className)}
      {...props}
    >
      {children}
      <span className="size-3.5 shrink-0">
        <BaseMenu.RadioItemIndicator>
          <Check aria-hidden className="size-3.5 text-tone-300" />
        </BaseMenu.RadioItemIndicator>
      </span>
    </BaseMenu.RadioItem>
  );
}

export function MenuGroupLabel({
  className,
  ...props
}: StyledProps<ComponentProps<typeof BaseMenu.GroupLabel>>) {
  return (
    <BaseMenu.GroupLabel
      className={cn("px-2.5 pt-1.5 pb-1 text-xs text-tone-500", className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: StyledProps<ComponentProps<typeof BaseMenu.Separator>>) {
  return (
    <BaseMenu.Separator
      className={cn("my-1 h-px bg-tone-800", className)}
      {...props}
    />
  );
}
