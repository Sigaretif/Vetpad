import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  pending: boolean;
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /** `destructive` for the confirmation of an action that cannot be undone (`ConfirmDialog.tsx`). */
  variant?: "default" | "destructive";
  /** Added to the button's own classes: a dialog's footer narrows it from `sm` up. */
  className?: string;
}

export function SubmitButton({
  pending,
  pendingText,
  icon,
  children,
  variant = "default",
  className,
}: SubmitButtonProps) {
  return (
    <Button type="submit" variant={variant} disabled={pending} className={cn("w-full", className)}>
      {pending ? (
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
