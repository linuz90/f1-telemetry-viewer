import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import { AppBrand } from "./AppBrand";
import { dashboardPath } from "../utils/routes";
import { cn } from "../utils/cn";

interface BrandHomeLinkProps {
  className?: string;
}

export function BrandHomeLink({ className }: BrandHomeLinkProps) {
  const location = useLocation();
  const { mode, activeFormulaKey } = useTelemetry();
  const homePath = dashboardPath(activeFormulaKey);
  const isDashboard = location.pathname === homePath;
  // In the prod no-data demo, the home page is positioned as a preview rather
  // than the user's own dashboard — so the back-link reads "Demo" to match.
  const homeLabel = mode === "demo" ? "Demo" : "Dashboard";

  return (
    <Link
      to={homePath}
      className={cn(
        "relative inline-flex items-center hover:opacity-80 transition-opacity",
        className,
      )}
    >
      {/* Invisible spacer keeps the container height stable while children are absolutely positioned for crossfade */}
      <span className="invisible" aria-hidden>
        <AppBrand />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        {isDashboard ? (
          <motion.span
            key="brand"
            className="absolute inset-0 inline-flex items-center whitespace-nowrap"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
          >
            <AppBrand />
          </motion.span>
        ) : (
          <motion.span
            key="back"
            className="absolute inset-0 inline-flex items-center gap-1.5 whitespace-nowrap"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
          >
            <ChevronLeft className="h-[1em] w-[1em]" />
            {homeLabel}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
