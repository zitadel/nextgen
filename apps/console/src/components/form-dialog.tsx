import type { ReactNode } from "react";

import {
  DIALOG_CONTENT,
  DIALOG_FOOTER,
  DIALOG_HEADER,
  DIALOG_TITLE,
} from "@/components/notice-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** A form dialog's body: the dialog's 24px inset, 16px between the fields. */
export const FORM_DIALOG_BODY = "flex flex-col gap-4 px-6 pb-6";

/**
 * The widths the design draws: 448px for a form with choice cards in it,
 * 384px for a single field, as the confirmations. The important suffix
 * beats the primitive's own `sm:max-w-lg`, which compiles to a
 * higher-specificity selector.
 */
const WIDTH = { md: "", sm: "sm:max-w-sm!" } as const;

/**
 * A dialog that holds a form: the title, a line under it when the form needs
 * one, then the form's body and its buttons, in the 24px rhythm and the
 * serif title the notice and confirm dialogs share.
 *
 * The caller owns `open`; `trigger` is the button that opens it, for callers
 * that have one. The children are the form, which lays its fields out in
 * {@link FORM_DIALOG_BODY} and its buttons in {@link FormDialogFooter}. The
 * primitive unmounts the content on close, which resets the form, so a
 * cancelled attempt does not carry into the next opening, and nothing is
 * unmounted early: the form stays through the close animation.
 */
export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  width = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: string;
  width?: keyof typeof WIDTH;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      {/* Without a description the primitive wants to be told so explicitly,
          or it warns; with one, it wires `aria-describedby` itself. */}
      <DialogContent
        className={cn(DIALOG_CONTENT, WIDTH[width])}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader className={DIALOG_HEADER}>
          <DialogTitle className={DIALOG_TITLE}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Cancel and the submit, right-aligned on the dialog's inset. */
export function FormDialogFooter({ children }: { children: ReactNode }) {
  return <DialogFooter className={DIALOG_FOOTER}>{children}</DialogFooter>;
}
