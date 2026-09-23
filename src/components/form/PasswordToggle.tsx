import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PasswordToggleProps {
  visible: boolean;
  onToggle: () => void;
}

export function PasswordToggle({ visible, onToggle }: PasswordToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
      aria-label={visible ? "Ukryj hasło" : "Pokaż hasło"}
      aria-pressed={visible}
    >
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </Button>
  );
}
