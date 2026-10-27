import { useState } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/form-error";
import {
  DIALOG_CONTENT,
  DIALOG_FOOTER,
  DIALOG_HEADER,
  DIALOG_TITLE,
  NoticeDialog,
} from "@/components/notice-dialog";
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
import { useSubmit } from "@/hooks/use-submit";
import { errorCode } from "@/lib/api-error";
import { useRequiredProjectScope } from "@/lib/project-scope";
import { RELEASE_IN_USE, revokeRelease } from "@/lib/release";

/** What a revoked release says. */
export const REVOKED_MESSAGE = "Release revoked";

/**
 * The Revoke release confirmation, and the refusal in its place.
 *
 * A release an origin still serves cannot be revoked: the server refuses it
 * with `rel.in_use`. The caller knows from the release's own deployments
 * whether one is live and passes `inUse`, so the refusal shows at once
 * instead of after a request; the server's answer is still honoured when
 * the screen is stale.
 *
 * Controlled by the caller, which opens it from a menu: a dialog nested in
 * the menu keeps the page `aria-hidden` once dismissed.
 */
export function RevokeReleaseDialog({
  releaseId,
  inUse,
  open,
  onOpenChange,
  onRevoked,
  onRefused,
}: {
  releaseId: string;
  /** Whether an origin still serves the release. */
  inUse: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the release is revoked, so the caller reads it again. */
  onRevoked: () => void | Promise<void>;
  /**
   * Called when the server refuses because an origin took the release since
   * the screen loaded, so the caller reads it again and shows that.
   */
  onRefused?: () => void | Promise<void>;
}) {
  const [refused, setRefused] = useState(false);
  const blocked = inUse || refused;

  if (blocked) {
    return (
      <NoticeDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setRefused(false);
        }}
        title="Release cannot be revoked"
        description="This release is still used by active deployments."
      />
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={DIALOG_CONTENT}>
        {/* Remounted per opening so a failed attempt never carries over. */}
        {open && (
          <RevokeForm
            releaseId={releaseId}
            onRefused={() => {
              setRefused(true);
              void onRefused?.();
            }}
            onRevoked={onRevoked}
            onClose={() => onOpenChange(false)}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevokeForm({
  releaseId,
  onRefused,
  onRevoked,
  onClose,
}: {
  releaseId: string;
  onRefused: () => void;
  onRevoked: () => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();

  const revoke = useSubmit(async () => {
    try {
      await revokeRelease(projectId, releaseId);
    } catch (cause) {
      // The screen was stale: an origin took the release since it loaded.
      if (errorCode(cause) === RELEASE_IN_USE) {
        onRefused();
        return;
      }
      throw cause;
    }
    // Raised from the root-mounted toaster, so it outlives this subtree.
    toast.success(REVOKED_MESSAGE);
    onClose();
    await onRevoked();
  }, "Could not revoke the release.");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void revoke.run();
  }

  return (
    <form onSubmit={submit}>
      <AlertDialogHeader className={DIALOG_HEADER}>
        <AlertDialogTitle className={DIALOG_TITLE}>Revoke</AlertDialogTitle>
        <AlertDialogDescription>
          This release will no longer be available for use after revocation.
        </AlertDialogDescription>
        <FormError message={revoke.error} />
      </AlertDialogHeader>
      <AlertDialogFooter className={DIALOG_FOOTER}>
        {/* `type="button"`: inside a form the primitive's bare button would
            submit, and revoke what Cancel is meant to spare. */}
        <AlertDialogCancel type="button" className="px-2.5!" disabled={revoke.pending}>
          Cancel
        </AlertDialogCancel>
        {/* Not `AlertDialogAction`: that closes on click, before the request
            settles. The close is driven by the request instead. */}
        <Button type="submit" variant="destructive" className="px-2.5" loading={revoke.pending}>
          Revoke release
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
