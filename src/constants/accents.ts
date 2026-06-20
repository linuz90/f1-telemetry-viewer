export interface AccentToken {
  /**
   * Four-sided inset box-shadow. Stored as literal static strings because
   * Tailwind only picks up class names it can see in source.
   */
  topLit: string;
  /** Tailwind background gradient. */
  bg: string;
  /** Text color for icons/eyebrows on the tile. */
  iconText: string;
  /** Strong accent text, often same as iconText. */
  accent: string;
}

export const ACCENT_TOKENS = {
  amber: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(245_158_11/0.26),inset_0_-1px_0_0_rgb(245_158_11/0.08),inset_1px_0_0_0_rgb(245_158_11/0.08),inset_-1px_0_0_0_rgb(245_158_11/0.08)]",
    bg: "bg-gradient-to-br from-amber-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-amber-300",
    accent: "text-amber-300",
  },
  rose: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(244_63_94/0.26),inset_0_-1px_0_0_rgb(244_63_94/0.08),inset_1px_0_0_0_rgb(244_63_94/0.08),inset_-1px_0_0_0_rgb(244_63_94/0.08)]",
    bg: "bg-gradient-to-br from-rose-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-rose-300",
    accent: "text-rose-300",
  },
  cyan: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(6_182_212/0.26),inset_0_-1px_0_0_rgb(6_182_212/0.08),inset_1px_0_0_0_rgb(6_182_212/0.08),inset_-1px_0_0_0_rgb(6_182_212/0.08)]",
    bg: "bg-gradient-to-br from-cyan-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-cyan-300",
    accent: "text-cyan-300",
  },
  emerald: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(16_185_129/0.26),inset_0_-1px_0_0_rgb(16_185_129/0.08),inset_1px_0_0_0_rgb(16_185_129/0.08),inset_-1px_0_0_0_rgb(16_185_129/0.08)]",
    bg: "bg-gradient-to-br from-emerald-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-emerald-300",
    accent: "text-emerald-300",
  },
  violet: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(139_92_246/0.26),inset_0_-1px_0_0_rgb(139_92_246/0.08),inset_1px_0_0_0_rgb(139_92_246/0.08),inset_-1px_0_0_0_rgb(139_92_246/0.08)]",
    bg: "bg-gradient-to-br from-violet-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-violet-300",
    accent: "text-violet-300",
  },
  fuchsia: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(217_70_239/0.26),inset_0_-1px_0_0_rgb(217_70_239/0.08),inset_1px_0_0_0_rgb(217_70_239/0.08),inset_-1px_0_0_0_rgb(217_70_239/0.08)]",
    bg: "bg-gradient-to-br from-fuchsia-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-fuchsia-300",
    accent: "text-fuchsia-300",
  },
  orange: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(249_115_22/0.26),inset_0_-1px_0_0_rgb(249_115_22/0.08),inset_1px_0_0_0_rgb(249_115_22/0.08),inset_-1px_0_0_0_rgb(249_115_22/0.08)]",
    bg: "bg-gradient-to-br from-orange-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-orange-300",
    accent: "text-orange-300",
  },
  sky: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(14_165_233/0.26),inset_0_-1px_0_0_rgb(14_165_233/0.08),inset_1px_0_0_0_rgb(14_165_233/0.08),inset_-1px_0_0_0_rgb(14_165_233/0.08)]",
    bg: "bg-gradient-to-br from-sky-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-sky-300",
    accent: "text-sky-300",
  },
  lime: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(132_204_22/0.26),inset_0_-1px_0_0_rgb(132_204_22/0.08),inset_1px_0_0_0_rgb(132_204_22/0.08),inset_-1px_0_0_0_rgb(132_204_22/0.08)]",
    bg: "bg-gradient-to-br from-lime-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-lime-300",
    accent: "text-lime-300",
  },
  zinc: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(161_161_170/0.26),inset_0_-1px_0_0_rgb(161_161_170/0.08),inset_1px_0_0_0_rgb(161_161_170/0.08),inset_-1px_0_0_0_rgb(161_161_170/0.08)]",
    bg: "bg-gradient-to-br from-zinc-400/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-zinc-200",
    accent: "text-zinc-200",
  },
  purple: {
    topLit:
      "shadow-[inset_0_1px_0_0_rgb(168_85_247/0.26),inset_0_-1px_0_0_rgb(168_85_247/0.08),inset_1px_0_0_0_rgb(168_85_247/0.08),inset_-1px_0_0_0_rgb(168_85_247/0.08)]",
    bg: "bg-gradient-to-br from-purple-500/[0.14] via-zinc-900/60 to-zinc-900/40",
    iconText: "text-purple-300",
    accent: "text-purple-300",
  },
} as const satisfies Record<string, AccentToken>;

export type AccentColor = keyof typeof ACCENT_TOKENS;
