import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { joinAnd } from "@/lib/text";

/** The grant a row's action revokes, and what the dialog must say about it. */
export interface Removable {
  /** Grant id — what `DELETE /grants/{id}` revokes. */
  grantId: string;
  /** Who the grant binds: the dialog's copy differs for a team's. */
  principal: "user" | "team";
  /** How the person keeps admin access once the grant is gone; empty when they do not. */
  keeps: string[];
  /**
   * A user ref with nothing but its id: the user is outside what the viewer
   * may read, or was deleted before deletes revoked grants. The copy claims
   * nothing about the account.
   */
  unresolved?: boolean;
}

/**
 * The revoke confirmation.
 *
 * `DELETE /grants/{id}` revokes one binding on one project — the `projectId`
 * of the project page whose admins section renders this, never the console's
 * own project (#1238). It touches no other access that person holds, so
 * someone who is also in the owning team, or in a granted team, keeps the
 * project, and the dialog says so instead of claiming they lose it (#1462).
 *
 * Unlike the delete-user dialog there is no type-to-confirm step: removing a
 * grant is reversible by adding the person again, where deleting a user is not.
 */
export function RemoveAdminDialog({
  projectId,
  removable,
  open,
  onOpenChange,
  onRemoved,
}: {
  /** The project the grant lives on. */
  projectId: string;
  removable: Removable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove grant?"
      description={describeRemoval(removable)}
      action="Remove grant"
      fallback="Could not remove grant. Try again."
      onConfirm={async () => {
        await api.deleteGrant(removable.grantId, { project_id: projectId });
        toast.success("Grant removed");
        onRemoved();
      }}
    />
  );
}

/** What the removal does to the row's access, as the grant's shape decides it. */
function describeRemoval(removable: Removable): string {
  if (removable.principal === "team") {
    return "Team members will lose access provided by this grant. Other access is unaffected.";
  }
  if (removable.unresolved) {
    return "User details are unavailable. Removing this grant revokes the access it provides.";
  }
  if (removable.keeps.length > 0) {
    return `The user will keep admin access through ${joinAnd(removable.keeps)}.`;
  }
  return "This removes the user's direct access grant to this project.";
}
