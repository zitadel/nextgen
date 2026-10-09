import { toast } from "sonner";

import { api } from "@/api/zitadel";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { useSubmit } from "@/hooks/use-submit";

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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* 384px, per the design. The important suffix is required: the
          primitive's own `data-[size=default]:sm:max-w-lg` compiles to a
          higher-specificity selector and would otherwise leave this 512px
          (same trap as the delete-user dialog). */}
      <AlertDialogContent className="sm:max-w-sm!">
        {/* The body is a child of the content, which the primitive unmounts on
            close, so its in-flight and error state starts clean every opening.
            Holding that state out here instead would carry a failed attempt's
            message into the next one. */}
        <RemoveAdminBody
          projectId={projectId}
          grantId={grantId}
          name={name}
          level={level}
          onOpenChange={onOpenChange}
          onRemoved={onRemoved}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemoveAdminBody({
  projectId,
  grantId,
  name,
  level,
  onOpenChange,
  onRemoved,
}: {
  projectId: string;
  grantId: string;
  name: string;
  level: string;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const remove = useSubmit(async () => {
    await api.deleteGrant(grantId, { project_id: projectId });
    // Raised before the dialog closes, from the root-mounted toaster.
    toast.success(`${name} removed`, {
      description: "They no longer have access to this project.",
    });
    onOpenChange(false);
    onRemoved();
  }, "The admin could not be removed.");

  const action = `Remove ${level.toLowerCase()}`;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{action}?</AlertDialogTitle>
        <AlertDialogDescription>
          They immediately lose access to this project. Their user account isn&apos;t deleted, and
          their access to other projects isn&apos;t affected.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {/* The API owns this copy (ADR 030), so the message is rendered verbatim
          rather than mapped to console-authored text. */}
      <FormError message={remove.error} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.pending}>Cancel</AlertDialogCancel>
        <Button variant="destructive" loading={remove.pending} onClick={() => void remove.run()}>
          {action}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
