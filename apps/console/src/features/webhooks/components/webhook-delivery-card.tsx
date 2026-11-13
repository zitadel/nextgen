import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { CARD_ACTION_BUTTON, DetailRow, DetailSection } from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { useSubmit } from "@/hooks/use-submit";
import { formatDateTime } from "@/lib/date";

import { lastError, type Webhook, webhookState } from "../model";
import { WebhookStatusBadge } from "./webhook-status-badge";

/** What each state means for the events, under the status. */
const STATE_NOTE = {
  active: "Events are sent as they are recorded.",
  failing:
    "The last attempt failed. The server keeps retrying, and holds back later events until one succeeds.",
  disabled:
    "No events are sent. Enabling starts again from now: what was recorded meanwhile is not sent.",
  stopped:
    "The server stopped sending after the endpoint kept failing. Enabling starts again from now: what was recorded meanwhile is not sent.",
} as const;

/**
 * How the webhook is doing, and the switch that stops and starts it: its
 * state, its last delivery, and the last failed attempt while that is the
 * newer of the two. The page shows the last result only; the API keeps no
 * history of attempts.
 *
 * Disabling stops delivery at once. Enabling starts it from now, for a
 * webhook the server stopped as for one a person did, so the card says that
 * the events in between are not sent.
 */
export function WebhookDeliveryCard({
  projectId,
  webhook,
  onChanged,
}: {
  projectId: string;
  webhook: Webhook;
  /** Called after the webhook was enabled or disabled, to read it again. */
  onChanged: () => void | Promise<void>;
}) {
  const state = webhookState(webhook);
  const error = lastError(webhook);
  const toggle = useSubmit(
    async () => {
      await api.updateWebhook(webhook.id, { enabled: !webhook.enabled }, { project_id: projectId });
      toast.success(webhook.enabled ? "Webhook disabled" : "Webhook enabled");
      await onChanged();
    },
    webhook.enabled ? "Could not disable the webhook." : "Could not enable the webhook.",
  );

  return (
    <DetailSection
      title="Delivery"
      action={
        <Button
          variant="secondary"
          size="sm"
          className={CARD_ACTION_BUTTON}
          loading={toggle.pending}
          onClick={() => void toggle.run()}
        >
          {webhook.enabled ? "Disable" : "Enable"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <DetailRow label="Status">
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <WebhookStatusBadge state={state} />
            <span className="text-muted-foreground">{STATE_NOTE[state]}</span>
          </div>
        </DetailRow>
        <DetailRow label="Last delivery">
          <span className="text-foreground">
            {webhook.last_delivered_at ? formatDateTime(webhook.last_delivered_at) : "Never"}
          </span>
        </DetailRow>
        {error && (
          <DetailRow label="Last error">
            <span className="text-destructive">{error}</span>
          </DetailRow>
        )}
      </div>
      <FormError message={toggle.error} />
    </DetailSection>
  );
}
