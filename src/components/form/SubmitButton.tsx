import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pending: boolean;
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
}

export function SubmitButton({ pending, pendingText, icon, children }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={pending} className="w-full">
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
