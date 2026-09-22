import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /** When given, overrides useFormStatus(), which never reports pending for a native POST to a string action. */
  pending?: boolean;
}

export function SubmitButton({ pendingText, icon, children, pending: pendingOverride }: SubmitButtonProps) {
  const status = useFormStatus();
  const pending = pendingOverride ?? status.pending;

  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
