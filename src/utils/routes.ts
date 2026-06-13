export function dashboardPath(formulaKey?: string | null): string {
  return formulaKey ? `/?formula=${encodeURIComponent(formulaKey)}` : "/";
}

export function sessionPath(slug: string): string {
  return `/session/${slug}`;
}
