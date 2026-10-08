import { TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { FormError } from "@/components/form-error";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/hooks/use-submit";

/**
 * The word the operator has to type before the action unlocks. Compared
 * case-sensitively: the design renders it uppercase, and a
 * confirmation step that accepts "delete" is not the barrier it appears to be.
 */
const CONFIRM_WORD = "DELETE";

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
//
// The registry's AlertDialogHeader is a grid that places the media beside a
// title/description pair. This design puts a third element in that column (the
// confirm field), which the grid would auto-place back under the media, so the
// header is laid out as the design's own structure instead: a row, 24px gap,
// with a 6px-gapped column beside the media.
// `max-w-sm` (384px) carries the important suffix because the primitive's own
// `data-[size=default]:sm:max-w-lg` compiles to a higher-specificity selector
// and would otherwise win, leaving the dialog 512px wide.
const CONTENT = "gap-0 rounded-xl p-0 sm:max-w-sm!";
const HEADER = "flex flex-row items-start gap-6 p-6 text-left";
// Flat 10% in both themes; only the destructive button lifts in dark.
const MEDIA = "bg-destructive/10 text-destructive";
const COLUMN = "flex min-w-0 flex-1 flex-col gap-1.5";
const TITLE = "font-serif text-lg leading-7 font-normal";
const FOOTER = "flex-row items-center justify-end gap-2 px-6 pb-6";

/**
 * The delete-user confirmation dialog.
 *
 * **The copy is literally true.** `DELETE /users/{user_id}` is a hard delete:
 * the service removes the user's memberships and the user row in one
 * transaction, and sessions are cascade-deleted by the foreign key added in
 * migration `000007`. There is no tombstone and no recovery window, which is
 * what the design decisions log records (D2) and what the body text promises.
 *
 * That still contradicts ADR 024 (Accepted), which specifies deactivate and
 * tombstone before purge — tracked in #694. If that decision reverses, this
 * dialog's copy is the first thing that has to change.
 */
export function DeleteUserDialog({
  userId,
  name,
  children,
  open: controlledOpen,
  onOpenChange,
  onDeleted,
}: {
  userId: string;
  /** Display name for the heading — the design reads `Delete {name}?`. */
  name: string;
  /**
   * The trigger, for callers that have one (the detail screen's danger card).
   *
   * Opening from a menu must **not** use a trigger: a Radix menu marks the rest
   * of the page `aria-hidden` while it is open, and nesting the dialog inside it
   * means the menu is still open underneath — so when the dialog closes the list
   * stays hidden from assistive tech and from Playwright's role queries. Those
   * callers control `open` instead and let the menu close on select.
   */
  children?: ReactNode;
  /** Controlled open state. Omit to let the trigger own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called after a successful delete, for list invalidation or navigation. */
  onDeleted: () => void | Promise<void>;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent className={CONTENT}>
        {/* Remounted per opening so a typed confirmation or a failed attempt
            never carries into the next one. */}
        {open && (
          <DeleteUserForm
            userId={userId}
            name={name}
            onDeleted={onDeleted}
            onClose={() => setOpen(false)}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteUserForm({
  userId,
  name,
  onDeleted,
  onClose,
}: {
  userId: string;
  name: string;
  onDeleted: () => void | Promise<void>;
  onClose: () => void;
}) {
  const confirmId = useId();
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === CONFIRM_WORD;

  // Kept open on failure: the operator has already typed the confirmation, and
  // closing would discard both that and the reason it failed.
  const remove = useSubmit(async () => {
    await api.deleteUserByID(userId);
    // Raised before the dialog closes, from the root-mounted toaster, so it
    // outlives this subtree — the caller may navigate away on `onDeleted`.
    toast.success(`${name} deleted`);
    await onDeleted();
    onClose();
  }, "Could not delete the user.");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmed) void remove.run();
  }

  return (
    <form onSubmit={submit}>
      <AlertDialogHeader className={HEADER}>
        <AlertDialogMedia className={MEDIA}>
          <TriangleAlert aria-hidden />
        </AlertDialogMedia>
        <div className={COLUMN}>
          <AlertDialogTitle className={TITLE}>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the user and all associated sessions, grants, and profile data.
            This action cannot be undone.
          </AlertDialogDescription>
          {/* The column's own 6px gap separates this from the description; the
              12px here is the field's internal label→input gap. */}
          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor={confirmId} className="text-foreground">
              Type {CONFIRM_WORD} to confirm
            </FieldLabel>
            <Input
              id={confirmId}
              name="confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              // The confirmation is a literal string, not a word the browser
              // should learn, complete, or correct on the operator's behalf.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          <FormError message={remove.error} className="mt-1.5" />
        </div>
      </AlertDialogHeader>

      <AlertDialogFooter className={FOOTER}>
        {/* `type="button"` is load-bearing: the Radix primitive renders a bare
            `<button>`, which inside a `<form>` defaults to `type="submit"` and
            would delete the user Cancel is meant to spare.

            `px-2.5!` — `AlertDialogCancel` puts this className on the element
            inside the Button's `asChild` slot, so it never passes through
            tailwind-merge and the size variant's `px-4` would otherwise win. */}
        <AlertDialogCancel type="button" className="px-2.5!" disabled={remove.pending}>
          Cancel
        </AlertDialogCancel>
        {/* Not `AlertDialogAction`: that primitive closes the dialog on click,
            which would tear down the pending state and the error surface before
            the request settles. The close is driven by the request instead. */}
        <Button
          type="submit"
          variant="destructive"
          className="gap-1.5 px-2.5"
          disabled={!confirmed}
          loading={remove.pending}
        >
          Delete user
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
