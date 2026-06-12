import type { FormulaScopeOption } from "../../utils/dashboardStats";
import { SegmentedControl } from "../ui/SegmentedControl";

export function FormulaScopeTabs({
  options,
  activeKey,
  onSelect,
}: {
  options: FormulaScopeOption[];
  activeKey: string | undefined;
  onSelect: (key: string) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <SegmentedControl
      ariaLabel="Formula scope"
      options={options.map((o) => ({ value: o.key, label: o.label }))}
      value={activeKey ?? options[0].key}
      onChange={onSelect}
      scrollable
      className="self-start"
    />
  );
}
