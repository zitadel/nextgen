import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { api } from "../api/zitadel";
import { describeError } from "../lib/api-error";
import { getConsoleProjectId } from "../runtime/runtime";

/**
 * The remove-admin confirmation (`Remove admin?` frame).
 *
 * **The copy is literally true.** `DELETE /grants/{id}` revokes one binding on
 * one project. It does not touch the user record, and it does not touch any
 * other grant that person holds, so the design's "their user account isn't
 * deleted, and their other team memberships aren't affected" is accurate rather
 * than reassuring.
 *
 * Unlike the delete-user dialog there is no type-to-confirm step: removing a
 * grant is reversible by adding the person again, where deleting a user is not.
 */
export function RemoveAdminDialog({
  grantId,
  name,
  open,
  onOpenChange,
  onRemoved,
}: {
  grantId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function remove() {
    setSubmitting(true);
    setError(undefined);
    try {
      await api.deleteGrant(grantId, { project_id: getConsoleProjectId() });
      // Raised before the dialog closes, from the root-mounted toaster.
      toast.success(`${name} removed`, {
        description: "They no longer have access to this project.",
      });
      onOpenChange(false);
      onRemoved();
    } catch (cause) {
      setError(describeError(cause, "The admin could not be removed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* 384px, per the frame. The important suffix is required: the
          primitive's own `data-[size=default]:sm:max-w-lg` compiles to a
          higher-specificity selector and would otherwise leave this 512px
          (same trap as the delete-user dialog). */}
      <AlertDialogContent className="sm:max-w-sm!">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove admin?</AlertDialogTitle>
          <AlertDialogDescription>
            They immediately lose access to this project. Their user account isn&apos;t deleted,
            and their access to other projects isn&apos;t affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* The API owns this copy (ADR 030), so the message is rendered verbatim
            rather than mapped to console-authored text. */}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={submitting} onClick={() => void remove()}>
            {submitting && <Loader2 className="size-3 animate-spin" aria-hidden />}
            Remove admin
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
