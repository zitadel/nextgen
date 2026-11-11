import { CopyBlock } from "@/components/copy-block";
import {
  DIALOG_CONTENT,
  DIALOG_FOOTER,
  DIALOG_HEADER,
  DIALOG_TITLE,
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
import { DOCS_URL } from "@/lib/docs";

/** The guide on checking a delivery's signature with the secret. */
export const VERIFY_GUIDE_URL = `${DOCS_URL}/guides/verify-webhook-signatures`;

/**
 * A webhook's signing secret, shown the one time the server returns it: after
 * the webhook is created, and after its secret is rotated.
 *
 * **The secret lives in the caller's state and nowhere else.** It is the
 * `secret` prop while the dialog is open, and the caller drops it on close.
 * It is never part of a loader's data, the URL or the router's state, so a
 * reload, the back button and a shared link cannot bring it back, and
 * nothing reports or logs it. Open while `secret` is set.
 *
 * An alert dialog, so a click beside it does not dismiss a value that cannot
 * be read again; `Done` and Escape do.
 */
export function WebhookSecretDialog({
  secret,
  note,
  onClose,
}: {
  /** The secret to show; the dialog is closed while there is none. */
  secret: string | undefined;
  /** A line under the secret, such as how long the previous one keeps working. */
  note?: string;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open={secret !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className={DIALOG_CONTENT}>
        <AlertDialogHeader className={DIALOG_HEADER}>
          <AlertDialogTitle className={DIALOG_TITLE}>Signing secret</AlertDialogTitle>
          <AlertDialogDescription>
            Every delivery to this webhook is signed with this secret. Copy it now and store it
            where your endpoint can read it: it will not be shown again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-6 text-sm text-muted-foreground">
          {secret !== undefined && <CopyBlock value={secret} label="Copy the signing secret" />}
          {note && <p>{note}</p>}
          <p>
            Your endpoint checks each request with it:{" "}
            <a
              href={VERIFY_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              Verify a webhook&rsquo;s signature
            </a>
            .
          </p>
        </div>
        <AlertDialogFooter className={DIALOG_FOOTER}>
          {/* `px-2.5!`: the cancel primitive puts this className inside the
              Button's `asChild` slot, past tailwind-merge. */}
          <AlertDialogCancel className="px-2.5!">Done</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
