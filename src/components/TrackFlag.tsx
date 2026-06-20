import { cn } from "../utils/cn";
import { getTrackCountryCode } from "../utils/tracks";

type TrackFlagSize = "tiny" | "small" | "medium" | "large";

interface TrackFlagProps {
  track: string;
  size?: TrackFlagSize;
  className?: string;
}

const SIZE_CLASSES: Record<TrackFlagSize, string> = {
  tiny: "h-2 w-3",
  small: "h-3 w-4",
  medium: "h-4 w-6",
  large: "h-6 w-8",
};

// flagcdn widths chosen so the 2x asset comfortably covers retina at each size.
const SIZE_WIDTHS: Record<TrackFlagSize, { base: number; retina: number }> = {
  tiny: { base: 20, retina: 40 },
  small: { base: 40, retina: 80 },
  medium: { base: 80, retina: 160 },
  large: { base: 160, retina: 320 },
};

export function TrackFlag({
  track,
  size = "small",
  className = "",
}: TrackFlagProps) {
  const code = getTrackCountryCode(track);
  if (!code) return null;

  const { base, retina } = SIZE_WIDTHS[size];
  const src = `https://flagcdn.com/w${base}/${code}.png`;
  const srcSet = `https://flagcdn.com/w${retina}/${code}.png 2x`;

  return (
    <img
      src={src}
      srcSet={srcSet}
      alt=""
      loading="lazy"
      className={cn(
        "inline-block rounded-[2px] object-cover",
        SIZE_CLASSES[size],
        className,
      )}
    />
  );
}
