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

/**
 * The revoke confirmation (`Remove admin?` frame), for one admin grant.
 *
 * **It revokes a grant, not a person.** A person can hold admin access several
 * ways (#1462), and `DELETE /grants/{id}` removes only one of them, so the
 * action names the grant and the copy names what the person keeps. Telling
 * someone who stays admin through the owning team that they lose access would
 * be false, and so would the reverse.
 *
 * **A team grant is the team's.** Revoking it removes the access it gives every
 * member of the team, not only the person whose row opened this, so the copy
 * says so.
 *
 * **The copy is otherwise literally true.** The grant lives on one project: the
 * `projectId` of the project page whose admins section renders this, never the
 * console's own project (#1238). It does not touch any user record, and it does
 * not touch any other grant, so "access to other projects isn't affected" is
 * accurate rather than reassuring.
 *
 * Unlike the delete-user dialog there is no type-to-confirm step: removing a
 * grant is reversible by adding the person again, where deleting a user is not.
 */
export function RemoveAdminDialog({
  projectId,
  grantId,
  name,
  team,
  keeps,
  open,
  onOpenChange,
  onRemoved,
}: {
  /** The project the grant lives on. */
  projectId: string;
  grantId: string;
  /** The person whose row the revoke was started from. */
  name: string;
  /** The team the grant is to; absent for a grant to the person. */
  team?: string;
  /** The person's other ways in, each phrased to finish "keeps admin access ...". */
  keeps: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* 384px, per the frame. The important suffix is required: the
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
          team={team}
          keeps={keeps}
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
  team,
  keeps,
  onOpenChange,
  onRemoved,
}: {
  projectId: string;
  grantId: string;
  name: string;
  team?: string;
  keeps: string[];
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function remove() {
    setSubmitting(true);
    setError(undefined);
    try {
      await api.deleteGrant(grantId, { project_id: projectId });
      // Raised before the dialog closes, from the root-mounted toaster.
      toast.success("Grant removed", {
        description: keeping ?? `${name} no longer has admin access to this project.`,
      });
      onOpenChange(false);
      onRemoved();
    } catch (cause) {
      setError(describeError(cause, "The grant could not be removed."));
    } finally {
      setSubmitting(false);
    }
  }

  const action = removeGrantAction(team);
  const keeping =
    keeps.length > 0 ? `${name} keeps admin access ${keeps.join(" and ")}.` : undefined;

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{action}?</AlertDialogTitle>
        <AlertDialogDescription>
          {team &&
            `Every member of Team ${team} loses the access this grant gives, not only ${name}. `}
          {keeping ?? `${name} immediately loses admin access to this project.`} No user account is
          deleted, and access to other projects isn&apos;t affected.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {/* The API owns this copy (ADR 030), so the message is rendered verbatim
          rather than mapped to console-authored text. */}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
        <Button variant="destructive" disabled={submitting} onClick={() => void remove()}>
          {submitting && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {action}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

/**
 * The revoke's label, on the row menu, the dialog title and its button alike.
 * It names the grant rather than the person, who may keep access another way.
 */
export function removeGrantAction(team?: string): string {
  return team ? `Remove grant to Team ${team}` : "Remove direct grant";
}
