import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";

import { draftOf, isComplete, updateBody, type Webhook, type WebhookDraft } from "../model";
import { useWebhookSave } from "../use-webhook-save";
import { WebhookFields } from "./webhook-fields";

/**
 * The webhook's editable fields, with their Save: the endpoint, the note and
 * the events, as the Add drawer asks for them.
 *
 * Save sends the fields that changed and no others (`updateBody`), and is
 * held while none has. A new endpoint takes over where the old one stopped,
 * and the signing secret stays the same. The caller keys the card by the
 * saved values, so the draft starts over from them after a save.
 */
export function WebhookDetailsCard({
  projectId,
  webhook,
  onSaved,
}: {
  projectId: string;
  webhook: Webhook;
  /** Called after a save, to read the webhook again. */
  onSaved: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<WebhookDraft>(() => draftOf(webhook));
  const body = updateBody(webhook, draft);
  const save = useWebhookSave(async () => {
    if (!body) return;
    await api.updateWebhook(webhook.id, body, { project_id: projectId });
    toast.success("Webhook saved");
    await onSaved();
  }, "Could not save the webhook.");

  return (
    <DetailSection title="Details">
      <form
        noValidate
        className="flex flex-col gap-4.5"
        onSubmit={(event) => {
          event.preventDefault();
          void save.run();
        }}
      >
        <WebhookFields
          draft={draft}
          refusal={save.refusal}
          onChange={(next) => {
            setDraft(next);
            save.clear();
          }}
        />
        <FormError message={save.refusal?.field ? undefined : save.refusal?.message} />
        <div className="flex justify-end">
          {/* Secondary, small, as every card's Save. */}
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className={CARD_ACTION_BUTTON}
            disabled={!body || !isComplete(draft)}
            loading={save.pending}
          >
            Save
          </Button>
        </div>
      </form>
    </DetailSection>
  );
}
