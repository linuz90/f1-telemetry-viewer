import { APP_NAME } from "../config/branding";

interface AppBrandProps {
  className?: string;
}

export function AppBrand({ className }: AppBrandProps) {
  return <span className={className}>{APP_NAME}</span>;
}
