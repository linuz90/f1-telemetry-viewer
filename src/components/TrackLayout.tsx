import { getTrackLayoutSvg } from "../utils/trackLayouts";

export function TrackLayout({
  track,
  className = "",
}: {
  track: string;
  className?: string;
}) {
  const svg = getTrackLayoutSvg(track);
  if (!svg) return null;
  return (
    <div
      aria-hidden
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
