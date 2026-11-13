import { type FormEvent, type ReactNode, useId, useState } from "react";

import { trackEvent } from "@/addon/analytics";
import { api } from "@/api/zitadel";
import { FormError } from "@/components/form-error";
import { FORM_DIALOG_BODY, FormDialog, FormDialogFooter } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { FieldOptionalIndicator } from "@/components/ui/field-optional-indicator";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSubmit } from "@/hooks/use-submit";

import { analyticsRole, PROJECT_ROLES, type ProjectRelation } from "../model";
import {
  CREATED_DESCRIPTION,
  CREATED_TITLE,
  type CreatedInvitation,
  InvitationCreated,
} from "./invitation-created";

/** The longest name the API stores (`metadata.name`). */
const NAME_MAX = 200;

/**
 * Invite somebody to a project with a link (root ADR 086, #2855).
 *
 * The invitation is addressed to nobody: whoever opens the link and is signed
 * in gets the role. The name is only a note for the administrators, so they
 * can tell the rows of the invitations table apart; it is never matched
 * against an account, and it is optional.
 *
 * One dialog, two steps. Creating swaps the form for the link in place, since
 * that response is the only time the link exists; closing after that reloads
 * the table behind it, where the new row is.
 */
export function InviteMemberDialog({
  children,
  projectId,
  projectName,
  onInvited,
}: {
  /** The button that opens the dialog. */
  children: ReactNode;
  /** The project the invitation is for: the selected one, never the console's own. */
  projectId: string;
  /** As the copied message names it. */
  projectName: string;
  /** Runs when the dialog closes after an invitation was created. */
  onInvited: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | undefined>(undefined);

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCreated(undefined);
        } else if (created) {
          onInvited();
        }
      }}
      trigger={children}
      title={created ? CREATED_TITLE : "Invite member"}
      description={created ? CREATED_DESCRIPTION : "Create an invitation link to share."}
    >
      {created ? (
        <InvitationCreated projectName={projectName} created={created} />
      ) : (
        <InviteForm projectId={projectId} onCreated={setCreated} onCancel={() => setOpen(false)} />
      )}
    </FormDialog>
  );
}

function InviteForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: (created: CreatedInvitation) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const nameId = `${id}-name`;
  const roleId = `${id}-role`;
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<ProjectRelation>("admin");

  // ADR 030: a refusal's own message is the human-facing string.
  const create = useSubmit(async () => {
    const trimmed = name.trim();
    const invitation = await api.createInvitation(
      {
        type: "project_member",
        project_member: { relation },
        ...(trimmed ? { metadata: { name: trimmed } } : {}),
      },
      { project_id: projectId },
    );
    trackEvent("invitation_created", {
      role: analyticsRole(invitation),
      invitation_journey_id: invitation.journey_id,
    });
    onCreated({ relation, link: invitation.link });
  }, "The invitation could not be created.");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void create.run();
  }

  return (
    // `contents` keeps the dialog's own column spacing: the form is here for
    // Enter-to-submit, not as a layout box.
    <form className="contents" onSubmit={submit}>
      <div className={FORM_DIALOG_BODY}>
        <Field>
          <div className="flex items-center gap-2">
            <FieldLabel htmlFor={nameId}>Invitee name</FieldLabel>
            <FieldOptionalIndicator />
          </div>
          <Input
            id={nameId}
            name="name"
            autoComplete="off"
            placeholder="e.g. Jane Doe"
            maxLength={NAME_MAX}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              create.clearError();
            }}
          />
        </Field>

        <Field>
          <FieldTitle id={roleId}>Role</FieldTitle>
          <RadioGroup
            aria-labelledby={roleId}
            className="gap-2"
            value={relation}
            onValueChange={(value) => {
              setRelation(value as ProjectRelation);
              create.clearError();
            }}
          >
            {PROJECT_ROLES.map((role) => {
              const itemId = `${id}-${role.relation}`;
              return (
                // A plain label, not `FieldLabel`: around a `Field` that one
                // draws a choice card, and the design draws bare radios.
                <label
                  key={role.relation}
                  htmlFor={itemId}
                  className="flex cursor-pointer items-start gap-3"
                >
                  <RadioGroupItem
                    value={role.relation}
                    id={itemId}
                    // Named by the role alone; what it allows is its description.
                    aria-labelledby={`${itemId}-label`}
                    aria-describedby={`${itemId}-description`}
                  />
                  <FieldContent className="gap-1 pt-px">
                    <FieldTitle id={`${itemId}-label`} className="leading-none font-medium">
                      {role.label}
                    </FieldTitle>
                    <FieldDescription id={`${itemId}-description`} className="leading-5">
                      {role.description}
                    </FieldDescription>
                  </FieldContent>
                </label>
              );
            })}
          </RadioGroup>
        </Field>

        <p className="text-muted-foreground text-xs leading-4">
          Invitation links expire in 72 hours.
        </p>
        <FormError message={create.error} />
      </div>

      <FormDialogFooter>
        <Button
          type="button"
          variant="outline"
          className="px-2.5"
          onClick={onCancel}
          disabled={create.pending}
        >
          Cancel
        </Button>
        <Button type="submit" className="px-2.5" loading={create.pending}>
          Create invitation
        </Button>
      </FormDialogFooter>
    </form>
  );
}
