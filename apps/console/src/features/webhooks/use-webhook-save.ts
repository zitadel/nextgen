import { useCallback, useState } from "react";

import { useSubmit } from "@/hooks/use-submit";

import { type WebhookRefusal, webhookRefusal } from "./model";

/**
 * A create or an update of a webhook, for its form: `useSubmit`'s pending
 * state, with a failure kept as a {@link WebhookRefusal} so the form can show
 * it on the field the server names. `clear` is for an edit, after which the
 * refusal describes a value the form no longer holds.
 */
export function useWebhookSave(action: () => Promise<void>, fallback: string) {
  const [refusal, setRefusal] = useState<WebhookRefusal | undefined>(undefined);
  const { run, pending } = useSubmit(async () => {
    setRefusal(undefined);
    try {
      await action();
    } catch (cause) {
      setRefusal(webhookRefusal(cause, fallback));
    }
  }, fallback);
  const clear = useCallback(() => setRefusal(undefined), []);

  return { run, pending, refusal, clear };
}
