import type { ReactNode } from "react";
import { PAGE_TAB_ICONS, pageTabClass, type PageTabKey } from "./pageTabs";

/** One tab of a session or track page's tab bar: its glyph, then its label. */
export function PageTab({
  tab,
  selected,
  onSelect,
  children,
}: {
  tab: PageTabKey;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const Icon = PAGE_TAB_ICONS[tab];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={pageTabClass(selected)}
    >
      <Icon
        aria-hidden
        className="mr-1.5 inline-block size-[1em] align-[-0.125em]"
      />
      {children}
    </button>
  );
}
