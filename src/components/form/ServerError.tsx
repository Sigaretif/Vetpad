import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ServerErrorProps {
  message?: string | null;
}

export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
