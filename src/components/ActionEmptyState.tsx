import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";
import { HStack, VStack } from "./ui/Stack";

export function ActionEmptyState({
  icon: Icon,
  title,
  message,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <VStack align="center" className={cn("max-w-sm text-center", className)}>
      <HStack justify="center" className="h-12 w-12 rounded-full bg-zinc-900">
        <Icon className="h-5 w-5 text-zinc-500" />
      </HStack>
      <div>
        <h3 className="text-base font-medium text-zinc-200">{title}</h3>
        <p className="mt-1 text-sm text-zinc-500">{message}</p>
      </div>
      {actions}
    </VStack>
  );
}
