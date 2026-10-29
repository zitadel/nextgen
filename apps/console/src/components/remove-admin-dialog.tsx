import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * The revoke confirmation.
 *
 * The action names the relation the row holds rather than always saying
 * "admin": this screen only creates `admin`, but the list shows whatever a
 * grant carries.
 *
 * **The copy is literally true.** `DELETE /grants/{id}` revokes one binding on
 * one project — the `projectId` of the project page whose admins section
 * renders this, never the console's own project (#1238). It does not touch the user record, and it does not touch any
 * other grant that person holds, so the design's "their user account isn't
 * deleted, and their other team memberships aren't affected" is accurate rather
 * than reassuring.
 *
 * Unlike the delete-user dialog there is no type-to-confirm step: removing a
 * grant is reversible by adding the person again, where deleting a user is not.
 */
export function RemoveAdminDialog({
  projectId,
  grantId,
  name,
  level,
  open,
  onOpenChange,
  onRemoved,
}: {
  /** The project the grant lives on. */
  projectId: string;
  grantId: string;
  name: string;
  /** The relation being revoked, title-cased, e.g. `Admin`. */
  level: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const action = `Remove ${level.toLowerCase()}`;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${action}?`}
      description="They immediately lose access to this project. Their user account isn't deleted, and their access to other projects isn't affected."
      action={action}
      fallback="The admin could not be removed."
      onConfirm={async () => {
        await api.deleteGrant(grantId, { project_id: projectId });
        toast.success(`${name} removed`, {
          description: "They no longer have access to this project.",
        });
        onRemoved();
      }}
    />
  );
}
