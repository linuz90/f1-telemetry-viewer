import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, ChevronRight, Copy } from "lucide-react";
import type { CarSetup } from "../../types/telemetry";
import type { WorthItem, WorthTarget } from "../../analysis/worthALook";
import { formatSetupText } from "../../analysis/shareText";
import { cn } from "../../utils/cn";

export function Panel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl bg-tone-900 p-5 ring-1 ring-tone-800",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-semibold text-tone-50">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-tone-500">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export interface StatDoor {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "best";
  /** A tab of this page, or a route. */
  onOpen?: () => void;
  to?: string;
}

/** The numbers row under a hero; each one opens the place with its story. */
export function StatDoors({ stats }: { stats: StatDoor[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-tone-800 ring-1 ring-tone-800 md:grid-cols-4">
      {stats.map((stat) => {
        const body = (
          <>
            <div className="flex items-center gap-1 text-xs text-tone-500">
              {stat.label}
              {(stat.onOpen || stat.to) && (
                <ChevronRight aria-hidden className="size-3 text-tone-600" />
              )}
            </div>
            <div
              className={cn(
                "mt-1 text-2xl font-semibold tracking-tight text-tone-50",
                stat.tone === "best" && "text-best",
              )}
            >
              {stat.value}
            </div>
            {stat.note && (
              <div className="mt-0.5 text-xs text-tone-500">{stat.note}</div>
            )}
          </>
        );
        const className = "block bg-tone-900 px-4 py-3.5 text-left";
        if (stat.to) {
          return (
            <Link
              key={stat.label}
              to={stat.to}
              className={cn(className, "hover:bg-tone-800/60")}
            >
              {body}
            </Link>
          );
        }
        if (stat.onOpen) {
          return (
            <button
              key={stat.label}
              type="button"
              onClick={stat.onOpen}
              className={cn(className, "hover:bg-tone-800/60")}
            >
              {body}
            </button>
          );
        }
        return (
          <div key={stat.label} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

const WORTH_SHOWN = 5;

/**
 * "Worth a look": the ranked list under every hero. Hidden when empty: no
 * padding, no placeholder.
 */
export function WorthList({
  title = "Worth a look",
  items,
  onOpen,
  expanded = false,
  onExpand,
}: {
  title?: string;
  items: WorthItem[];
  onOpen: (target: WorthTarget) => void;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, WORTH_SHOWN);
  return (
    <section>
      <h2 className="mb-2.5 text-base font-semibold text-tone-50">{title}</h2>
      <ol className="overflow-hidden rounded-2xl bg-tone-900 ring-1 ring-tone-800">
        {shown.map((item, i) => (
          <li
            key={item.id}
            className="border-t border-tone-800/70 first:border-t-0"
          >
            <button
              type="button"
              onClick={() => onOpen(item.target)}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left text-sm hover:bg-tone-800/40"
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold",
                  item.tone === "loss" && "bg-behind/15 text-behind",
                  item.tone === "gain" && "bg-ahead/15 text-ahead",
                  item.tone === "note" && "bg-warning/15 text-warning",
                )}
              >
                {i + 1}
              </span>
              <span className="flex-1 leading-relaxed text-tone-400">
                <b className="font-medium text-tone-50">{item.claim}</b>
                {item.evidence && <> {item.evidence}</>}
              </span>
              <span className="hidden shrink-0 items-center gap-1 pt-0.5 text-xs text-tone-500 sm:inline-flex">
                {item.targetLabel}
                <ArrowUpRight aria-hidden className="size-3" />
              </span>
            </button>
          </li>
        ))}
      </ol>
      {items.length > WORTH_SHOWN && !expanded && onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="mt-2 text-sm text-tone-400 hover:text-tone-100"
        >
          Show {items.length - WORTH_SHOWN} more
        </button>
      )}
    </section>
  );
}

/** Rows of the copy shorthand, with Suspension split into its three pairs. */
function setupRows(setup: CarSetup): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const line of formatSetupText(setup).split("\n")) {
    const [label, value] = line.split(/:\s*/);
    if (label === "Suspension") {
      const [springs, arb, height] = value.split(" ");
      rows.push({ label: "Springs", value: springs });
      rows.push({ label: "Anti-roll bars", value: arb });
      rows.push({ label: "Ride height", value: height });
    } else if (label === "Suspension Geometry") {
      rows.push({
        label: "Geometry",
        value: value === "L-L-L-L" ? "All left" : value,
      });
    } else if (label === "Brake Bias") {
      const [bias, pressure] = value.split("-");
      rows.push({ label: "Brake bias", value: bias });
      rows.push({ label: "Brake pressure", value: pressure });
    } else if (label === "Tyres") {
      // "27.0-MIN": front then rear, one pressure per axle.
      const [front, rear] = value.split("-");
      rows.push({ label: "Tyres front", value: front });
      rows.push({ label: "Tyres rear", value: rear ?? front });
    } else {
      rows.push({
        label:
          label === "Aerodynamics"
            ? "Aero"
            : label === "Transmission"
              ? "Diff"
              : label,
        value,
      });
    }
  }
  return rows;
}

/**
 * A setup in the shorthand setup creators share (Aero 48-21, Diff 100-85),
 * in the game's own section order so it types straight in, with Copy.
 */
export function SetupSheet({
  setup,
  title,
  meta,
  action,
}: {
  setup: CarSetup;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight text-tone-50">
            {title}
          </div>
          {meta && <div className="mt-0.5 text-xs text-tone-500">{meta}</div>}
        </div>
        {action}
      </div>
      <dl className="mt-3 border-t border-tone-800">
        {setupRows(setup).map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between border-b border-tone-800 py-2 text-sm"
          >
            <dt className="text-tone-400">{row.label}</dt>
            <dd className="font-mono font-semibold text-tone-50">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <CopySetupButton text={formatSetupText(setup)} />
    </div>
  );
}

function CopySetupButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium text-tone-100 ring-1 ring-tone-700 transition-colors hover:bg-tone-800"
    >
      {copied ? (
        <Check className="size-3.5 text-ahead" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy setup"}
    </button>
  );
}
