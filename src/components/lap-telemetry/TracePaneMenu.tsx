import { ChevronDown } from "lucide-react";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/Menu";
import {
  DEFAULT_PANE_VISIBILITY,
  PANE_SPECS,
  type PaneId,
  type PaneVisibility,
} from "./panes";

/** Dropdown that shows or hides each trace pane the current laps can draw. */
export function TracePaneMenu({
  available,
  visibility,
  onChange,
}: {
  available: readonly PaneId[];
  visibility: PaneVisibility;
  onChange: (next: PaneVisibility) => void;
}) {
  const visibleCount = available.filter((id) => visibility[id]).length;
  const isDefault = available.every(
    (id) => visibility[id] === DEFAULT_PANE_VISIBILITY[id],
  );

  return (
    <Menu>
      <MenuTrigger className="group flex items-center gap-1.5 rounded-lg bg-tone-900/60 px-2.5 py-1.5 text-xs font-medium text-tone-300 transition-colors hover:text-tone-100 data-popup-open:text-tone-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-tone-600">
        Traces
        <span className="tabular-nums text-tone-500">
          {visibleCount}/{available.length}
        </span>
        <ChevronDown
          aria-hidden
          className="size-3 text-tone-500 transition-transform group-data-popup-open:rotate-180"
        />
      </MenuTrigger>
      <MenuPopup aria-label="Visible traces" className="w-44">
        {available.map((id) => (
          <MenuCheckboxItem
            key={id}
            checked={visibility[id]}
            // Keep one pane so the chart never collapses to a bare axis.
            disabled={visibility[id] && visibleCount === 1}
            onCheckedChange={(checked) =>
              onChange({ ...visibility, [id]: checked })
            }
          >
            {PANE_SPECS[id].label}
          </MenuCheckboxItem>
        ))}
        {!isDefault && (
          <>
            <MenuSeparator />
            {/* Resetting is the last thing you do here, and this row
                disappears once the panes are back to default, so close. */}
            <MenuItem
              onClick={() => onChange(DEFAULT_PANE_VISIBILITY)}
              className="text-xs text-tone-400"
            >
              Reset to default
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
