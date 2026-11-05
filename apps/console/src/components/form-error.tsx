import { AlertCircle } from "lucide-react";

import { Alert, AlertTitle } from "@/components/ui/alert";

/** A failed mutation's message, inline where the action was taken. */
export function FormError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle aria-hidden />
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  );
}
