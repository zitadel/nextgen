import { type ReactNode, useState } from "react";

import { FormSheet, FormSheetForm } from "@/components/form-sheet";
import { useRequiredProjectScope } from "@/features/projects/project-scope";

import { createWebhook } from "../api";
import { EMPTY_DRAFT, isComplete, type WebhookDraft } from "../model";
import { useWebhookSave } from "../use-webhook-save";
import { WebhookFields } from "./webhook-fields";

/**
 * The Add webhook drawer (D15): the endpoint, an optional note and the events
 * it gets. The server makes the signing secret and returns it once, with the
 * created webhook: `onCreated` takes it, for the dialog that shows it.
 *
 * The browser's own checks stay out of the form: the server's refusal is
 * shown on the field it names, in its words, so there is one wording for a
 * URL that is not `https`. A refusal that names no field (the project's
 * limit, should another tab have reached it) shows above the buttons.
 */
export function AddWebhookSheet({
  children,
  onCreated,
}: {
  /** The trigger: the Webhooks title's `Add` button. */
  children: ReactNode;
  /** Called with the new webhook's secret once it is created. */
  onCreated: (secret: string) => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children}>
      {(close) => <AddWebhookForm onCreated={onCreated} onClose={close} />}
    </FormSheet>
  );
}

function AddWebhookForm({
  onCreated,
  onClose,
}: {
  onCreated: (secret: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();
  const [draft, setDraft] = useState<WebhookDraft>(EMPTY_DRAFT);
  const save = useWebhookSave(async () => {
    const secret = await createWebhook(projectId, draft);
    onClose();
    await onCreated(secret);
  }, "Could not add the webhook.");

  return (
    <FormSheetForm
      title="Add webhook"
      submitLabel="Add webhook"
      canSubmit={isComplete(draft)}
      pending={save.pending}
      error={save.refusal?.field ? undefined : save.refusal?.message}
      noValidate
      onSubmit={() => void save.run()}
      onClose={onClose}
    >
      <WebhookFields
        draft={draft}
        refusal={save.refusal}
        onChange={(next) => {
          setDraft(next);
          save.clear();
        }}
      />
    </FormSheetForm>
  );
}
