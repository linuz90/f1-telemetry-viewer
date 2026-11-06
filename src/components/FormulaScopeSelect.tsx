import { ChevronsUpDown } from "lucide-react";
import type { FormulaScopeOption } from "../utils/formulaScope";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/Menu";

interface Props {
  options: readonly FormulaScopeOption[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * The top bar's game switcher: an in-app menu rather than a native select so
 * it matches the bar's other menus, with each game's session count.
 */
export function FormulaScopeSelect({ options, value, onChange }: Props) {
  const current = options.find((option) => option.key === value);

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Game: ${current?.label ?? value}`}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium whitespace-nowrap text-tone-100 outline-none transition-colors hover:bg-tone-900 data-popup-open:bg-tone-900 focus-visible:ring-1 focus-visible:ring-tone-600"
      >
        {current?.label ?? value}
        <ChevronsUpDown aria-hidden className="size-3.5 text-tone-500" />
      </MenuTrigger>
      <MenuPopup aria-label="Games" className="w-56 text-sm">
        <MenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <MenuRadioItem
              key={option.key}
              value={option.key}
              label={option.label}
              className="text-tone-300"
            >
              <span className="flex-1 font-medium">{option.label}</span>
              <span className="text-xs text-tone-500 tabular-nums">
                {option.sessionCount.toLocaleString()} sessions
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
