import { getTrackCountryCode } from "../utils/format";

interface TrackFlagProps {
  track: string;
  className?: string;
}

export function TrackFlag({ track, className = "" }: TrackFlagProps) {
  const code = getTrackCountryCode(track);
  if (!code) return null;

  const src = `https://flagcdn.com/w40/${code}.png`;
  const srcSet = `https://flagcdn.com/w80/${code}.png 2x`;

  return (
    <img
      src={src}
      srcSet={srcSet}
      alt=""
      loading="lazy"
      className={`inline-block rounded-[2px] h-3 w-4 object-cover ${className}`}
    />
  );
}
