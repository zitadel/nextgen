import type { ReactNode } from "react";

import { FormError } from "@/components/form-error";
import { DIALOG_FOOTER } from "@/components/notice-dialog";
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

/**
 * The design's confirmation: 384px, the title over its explanation, Cancel
 * and the destructive action. The primitive's own gaps are replaced by the
 * design's 24px rhythm. `sm:max-w-sm!` carries the important suffix because
 * the primitive's `data-[size=default]:sm:max-w-lg` compiles to a
 * higher-specificity selector.
 */
export const CONFIRM_CONTENT = "gap-0 rounded-md p-0 sm:max-w-sm!";
export const CONFIRM_TITLE = "font-serif text-lg leading-7 font-normal";
const HEADER = "flex flex-col gap-1.5 p-6 text-left";

/**
 * A destructive action the operator confirms: remove, revoke, delete.
 *
 * `onConfirm` is the request, with whatever follows it (a toast, a reload).
 * The dialog closes when it resolves, and a rejection is shown inline (ADR
 * 030: the API's own message, verbatim), so the close is driven by the request
 * rather than by the click. The body is a child of the content, which the
 * primitive unmounts on close, so a failed attempt's message does not carry
 * into the next opening.
 *
 * Confirmations with more in them, such as a type-to-confirm field or a
 * leading icon, compose the primitives themselves.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  fallback,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** The confirming button's label. */
  action: string;
  /** The message when the request fails without one of its own. */
  fallback: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={CONFIRM_CONTENT}>
        <ConfirmBody
          title={title}
          description={description}
          action={action}
          fallback={fallback}
          onConfirm={onConfirm}
          onDone={() => onOpenChange(false)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmBody({
  title,
  description,
  action,
  fallback,
  onConfirm,
  onDone,
}: {
  title: ReactNode;
  description: ReactNode;
  action: string;
  fallback: string;
  onConfirm: () => Promise<void>;
  onDone: () => void;
}) {
  const confirm = useSubmit(async () => {
    await onConfirm();
    onDone();
  }, fallback);

  return (
    <>
      <AlertDialogHeader className={HEADER}>
        <AlertDialogTitle className={CONFIRM_TITLE}>{title}</AlertDialogTitle>
        <AlertDialogDescription className="wrap-anywhere">{description}</AlertDialogDescription>
        <FormError message={confirm.error} />
      </AlertDialogHeader>
      <AlertDialogFooter className={DIALOG_FOOTER}>
        <AlertDialogCancel className="px-2.5!" disabled={confirm.pending}>
          Cancel
        </AlertDialogCancel>
        {/* Not `AlertDialogAction`: that closes on click, before the request
            settles. */}
        <Button
          variant="destructive"
          className="px-2.5"
          loading={confirm.pending}
          onClick={() => void confirm.run()}
        >
          {action}
        </Button>
      </AlertDialogFooter>
    </>
  );
}
