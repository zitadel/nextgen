import { useState } from "react";
import { toast } from "sonner";

import { trackEvent } from "@/addon/analytics";
import { api } from "@/api/zitadel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowMenu } from "@/components/resource-list";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

import { createProjectInvitation } from "../api";
import {
  analyticsRole,
  type CreatedInvitation,
  type Invitation,
  type InvitationStatus,
} from "../model";

/** The words of deleting an invitation, which differ by what is being deleted. */
interface Removal {
  action: string;
  title: string;
  description: string;
  fallback: string;
  done: string;
}

/** What a row's menu offers. */
interface RowActions {
  /** Regenerate link: a new link for the same person and role. */
  regenerate: boolean;
  /** How the row is deleted, where the server deletes its status. */
  removal?: Removal;
  /** Whether deleting it ends a link that still worked. */
  cancels?: boolean;
}

/**
 * The menu by status. A pending link is cancelled: it stops working. An
 * expired or a declined one already has, so deleting it is `Remove` and only
 * takes the row and the name on it out of the list. An accepted invitation is
 * final and has no menu: `DELETE /invitations/{invitation_id}` answers it
 * with the opaque `404`.
 */
export const ACTIONS: Partial<Record<InvitationStatus, RowActions>> = {
  pending: {
    regenerate: true,
    cancels: true,
    removal: {
      action: "Cancel invitation",
      title: "Cancel invitation?",
      description: "This invitation link will stop working.",
      fallback: "Could not cancel the invitation. Try again.",
      done: "Invitation cancelled",
    },
  },
  expired: {
    regenerate: true,
    removal: {
      action: "Remove invitation",
      title: "Remove expired invitation?",
      description: "The link has expired. Removing the invitation takes it off this list.",
      fallback: "Could not remove the invitation. Try again.",
      done: "Invitation removed",
    },
  },
  rejected: {
    regenerate: false,
    removal: {
      action: "Remove invitation",
      title: "Remove declined invitation?",
      description: "The invitation was declined. Removing it takes it off this list.",
      fallback: "Could not remove the invitation. Try again.",
      done: "Invitation removed",
    },
  },
};

/** A row's menu and the confirmations behind its items. */
export function InvitationActions({
  projectId,
  invitation,
  name,
  actions,
  onCancelled,
  onReplaced,
}: {
  projectId: string;
  invitation: Invitation;
  name: string;
  actions: RowActions;
  onCancelled: () => void;
  onReplaced: (created: CreatedInvitation) => void;
}) {
  const { regenerate, removal, cancels } = actions;
  const [dialog, setDialog] = useState<"regenerate" | "cancel" | undefined>(undefined);
  const close = (open: boolean) => {
    if (!open) setDialog(undefined);
  };

  return (
    <>
      <RowMenu name={name} contentClassName="w-50">
        {regenerate && (
          <DropdownMenuItem onSelect={() => setDialog("regenerate")}>
            Regenerate link
          </DropdownMenuItem>
        )}
        {regenerate && removal && <DropdownMenuSeparator />}
        {removal && (
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("cancel")}>
            {removal.action}
          </DropdownMenuItem>
        )}
      </RowMenu>

      <ConfirmDialog
        open={dialog === "regenerate"}
        onOpenChange={close}
        variant="default"
        title="Regenerate invitation link?"
        description={
          cancels
            ? "The current link will stop working. The new link will be shown only once and expires in 72 hours."
            : "The new link will be shown only once and expires in 72 hours."
        }
        action="Regenerate link"
        fallback="Could not regenerate the link. Try again."
        onConfirm={async () => {
          // Only project invitations can be made here; a team invitation's row
          // has no menu until its type ships (root ADR 086 §1).
          if (invitation.type !== "project_member") return;
          const { relation } = invitation.project_member;
          onReplaced(
            await createProjectInvitation(projectId, {
              relation,
              name: invitation.metadata?.name,
              replaces: invitation.id,
            }),
          );
        }}
      />

      {removal && (
        <ConfirmDialog
          open={dialog === "cancel"}
          onOpenChange={close}
          title={removal.title}
          description={removal.description}
          cancel="Keep invitation"
          action={removal.action}
          fallback={removal.fallback}
          onConfirm={async () => {
            await api.cancelInvitation(invitation.id, { project_id: projectId });
            // Only a link that still worked was cancelled; the rest were
            // already dead and removing them is housekeeping.
            if (cancels) {
              trackEvent("invitation_cancelled", {
                role: analyticsRole(invitation),
                invitation_journey_id: invitation.journey_id,
              });
            }
            toast.success(removal.done);
            onCancelled();
          }}
        />
      )}
    </>
  );
}
