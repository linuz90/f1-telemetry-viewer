import { Gamepad2 } from "lucide-react";
import type { FormulaScopeOption } from "../utils/formulaScope";
import { PillSelect } from "./ui/PillSelect";

interface Props {
  options: readonly FormulaScopeOption[];
  value: string;
  onChange: (value: string) => void;
}

export function FormulaScopeSelect({ options, value, onChange }: Props) {
  return (
    <PillSelect
      value={value}
      onChange={onChange}
      options={options.map((option) => ({
        value: option.key,
        label: option.label,
      }))}
      ariaLabel="Game scope"
      leadingIcon={Gamepad2}
      size="sm"
    />
  );
}
