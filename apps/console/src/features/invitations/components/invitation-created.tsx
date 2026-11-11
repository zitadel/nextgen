import { useId } from "react";
import { toast } from "sonner";

import { FORM_DIALOG_BODY, FormDialog } from "@/components/form-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";

import { invitationMessage, type ProjectRelation } from "../model";

/** What a create or a replace returned that the dialog shows: the link, once. */
export interface CreatedInvitation {
  relation: ProjectRelation;
  link: string;
}

export const CREATED_TITLE = "Invitation created";
export const CREATED_DESCRIPTION = "This link is shown only once. Copy the invitation message now.";

/**
 * The one moment the link exists outside the server (root ADR 086 §2): only the
 * create response carries it, so it is shown here and nowhere else. It is
 * wrapped in the message an administrator sends, since the link alone says
 * neither what it grants nor that it runs out.
 *
 * The link is a bearer credential for the role, addressed to nobody: the line
 * under the field says so, as the CLI does when it prints one.
 */
export function InvitationCreated({
  projectName,
  created,
}: {
  projectName: string;
  created: CreatedInvitation;
}) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const message = invitationMessage(
    projectName,
    { type: "project_member", project_member: { relation: created.relation } },
    created.link,
  );

  return (
    <div className={FORM_DIALOG_BODY}>
      <Field>
        <FieldLabel htmlFor={fieldId} className="font-medium">
          Invitation message
        </FieldLabel>
        <InputGroup className="bg-card">
          <InputGroupTextarea
            id={fieldId}
            readOnly
            value={message}
            aria-describedby={hintId}
            className="min-h-32 wrap-anywhere"
            // The whole message is the thing to take: a click selects it, for
            // an origin where the clipboard is not available to the button.
            onFocus={(event) => event.currentTarget.select()}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            <CopyButton
              value={message}
              label="Copy invitation message"
              onCopied={() => toast.success("Invitation message copied")}
            />
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription id={hintId} className="text-xs leading-4">
          Whoever opens the link gets this role.
        </FieldDescription>
      </Field>
    </div>
  );
}

/**
 * The link of a replaced invitation, in a dialog of its own: the row's
 * confirmation has closed by the time there is a link to show.
 */
export function InvitationCreatedDialog({
  projectName,
  created,
  onClose,
}: {
  projectName: string;
  /** The replacement; the dialog is open while there is one. */
  created: CreatedInvitation | undefined;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={created !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={CREATED_TITLE}
      description={CREATED_DESCRIPTION}
    >
      {created && <InvitationCreated projectName={projectName} created={created} />}
    </FormDialog>
  );
}
