import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";

/** "Sessions › Mon 26 Oct": a link back to the parent page, then where you are. */
export function Breadcrumb({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="text-xs text-tone-500">
      <Link to={to} className="hover:text-tone-200">
        {label}
      </Link>
      {children && <> › {children}</>}
    </div>
  );
}

/**
 * The title block at the top of a page: an optional breadcrumb, the page's h1,
 * a one-line subtitle, and an optional control on the right. Session and track
 * pages open with their own hero instead.
 */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  action,
  className,
}: {
  breadcrumb?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-5 flex flex-wrap items-end justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumb}
        <h1
          className={cn(
            "text-2xl font-semibold tracking-tight text-tone-50",
            breadcrumb && "mt-1",
          )}
        >
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-tone-500">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
