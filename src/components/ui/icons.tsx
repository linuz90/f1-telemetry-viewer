type IconProps = { className?: string };

export function XIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.86l-5.37-7.02L4.6 22H1.34l8.03-9.18L1 2h7.03l4.85 6.41L18.244 2zm-2.4 18h1.9L7.27 4H5.27l10.57 16z" />
    </svg>
  );
}
