export type FormControlSize = "sm" | "md";
export type FormControlWidth = "auto" | "compact" | "session" | "full";

export const FORM_CONTROL_CONTAINER_STYLES =
  "relative inline-flex min-w-0 max-w-full";

export const FORM_CONTROL_WIDTH_STYLES: Record<FormControlWidth, string> = {
  auto: "w-auto",
  compact: "w-[min(15rem,calc(100vw-3rem))]",
  session: "w-[min(20rem,calc(100vw-3rem))]",
  full: "w-full",
};

export const FORM_CONTROL_CHROME_STYLES =
  "w-full min-w-0 border border-zinc-800/80 bg-zinc-900/70 font-medium text-zinc-200 outline-none transition-colors hover:border-zinc-700 focus:ring-1 focus:ring-zinc-500/40";

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
