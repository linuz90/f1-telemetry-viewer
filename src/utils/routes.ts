export function dashboardPath(formulaKey?: string | null): string {
  return formulaKey ? `/?formula=${encodeURIComponent(formulaKey)}` : "/";
}

export function sessionFormulaPath(
  slug: string,
  formulaKey?: string | null,
): string {
  return formulaKey
    ? `/session/${slug}?formula=${encodeURIComponent(formulaKey)}`
    : `/session/${slug}`;
}
