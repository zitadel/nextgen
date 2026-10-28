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
  /** The catalog relation the grant carries, lower-cased, e.g. `admin`. */
  level: string;
  /** How the person keeps admin access once the grant is gone; empty when they do not. */
  keeps: string[];
  /**
   * A user ref with nothing but its id: the user was deleted, or is outside
   * what the viewer may read. The two look the same on the wire, so the copy
   * claims nothing about the account.
   */
  unresolved?: boolean;
}

/**
 * The revoke confirmation.
 *
 * The action names the relation the grant holds rather than always saying
 * "admin": this screen only creates `admin`, but the list shows whatever a
 * grant carries.
 *
 * **The copy is literally true.** `DELETE /grants/{id}` revokes one binding on
 * one project — the `projectId` of the project page whose admins section
 * renders this, never the console's own project (#1238). It does not touch the
 * user record, and it does not touch any other grant that person holds, so the
 * design's "their user account isn't deleted, and their other team memberships
 * aren't affected" is accurate rather than reassuring. And it does not touch
 * access that is not this grant: a person who is also in the owning team, or in
 * a granted team, keeps the project, and the dialog says so instead of claiming
 * they lose it (#1462).
 *
 * Unlike the delete-user dialog there is no type-to-confirm step: removing a
 * grant is reversible by adding the person again, where deleting a user is not.
 */
export function RemoveAdminDialog({
  projectId,
  name,
  removable,
  open,
  onOpenChange,
  onRemoved,
}: {
  /** The project the grant lives on. */
  projectId: string;
  name: string;
  removable: Removable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const action = `Remove ${removable.level}`;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${action}?`}
      description={describeRemoval(removable)}
      action={action}
      fallback="The admin could not be removed."
      onConfirm={async () => {
        await api.deleteGrant(removable.grantId, { project_id: projectId });
        toast.success(...describeRemoved(name, removable));
        onRemoved();
      }}
    />
  );
}

/** What the removal does to the row's access, as the grant's shape decides it. */
function describeRemoval(removable: Removable): string {
  if (removable.principal === "team") {
    return "Everyone in this team loses the access this grant gave them. Members who have access to this project another way keep it.";
  }
  if (removable.unresolved) {
    return "Nothing about this user can be read: they may have been deleted, or be outside what you can see. Removing the grant leaves the user record as it is and takes this project from them if they still exist.";
  }
  if (removable.keeps.length > 0) {
    return `This removes only the grant made to them directly. They keep admin access through ${joinAnd(removable.keeps)}, so they can still manage this project.`;
  }
  return "They immediately lose access to this project. Their user account isn't deleted, and their access to other projects isn't affected.";
}

/** The toast after a removal: its title and description. */
function describeRemoved(name: string, removable: Removable): [string, { description: string }] {
  if (removable.principal === "team") {
    return [
      `Grant to ${name} removed`,
      { description: "Its members no longer have access through it." },
    ];
  }
  if (removable.unresolved) {
    return [
      `Grant to ${name} removed`,
      { description: "It no longer gives access to this project." },
    ];
  }
  if (removable.keeps.length > 0) {
    return [
      `Grant to ${name} removed`,
      { description: `They still have admin access through ${joinAnd(removable.keeps)}.` },
    ];
  }
  return [`${name} removed`, { description: "They no longer have access to this project." }];
}
