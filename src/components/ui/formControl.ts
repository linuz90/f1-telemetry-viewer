export type FormControlSize = "sm" | "md";

export const FORM_CONTROL_SIZE_STYLES: Record<
  FormControlSize,
  { control: string; yPadding: string }
> = {
  sm: {
    control: "h-6.5 rounded-md text-2xs",
    yPadding: "py-1",
  },
  md: {
    control: "h-7.5 rounded-lg text-xs",
    yPadding: "py-1.5",
  },
};
