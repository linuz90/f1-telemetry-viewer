import { isProblemStatus, resultStatusLabel } from "./dashboard/helpers";
import { Badge } from "./ui/Badge";

/** Keeps terminal race statuses visible wherever a classification is shown. */
export function SessionResultStatusBadge({ status }: { status?: string }) {
  if (!isProblemStatus(status)) return null;
  return <Badge tone="red">{resultStatusLabel(status)}</Badge>;
}
