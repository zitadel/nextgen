import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// The design's refusal dialog: 448px, a title over one line of explanation,
// and Close. `sm:max-w-md!` carries the important suffix because the
// primitive's own `data-[size=default]:sm:max-w-lg` compiles to a
// higher-specificity selector.
export const DIALOG_CONTENT = "gap-0 rounded-md p-0 sm:max-w-md!";
// The registry's header is a centred grid; the design stacks the pair at the
// left, 8px apart.
export const DIALOG_HEADER = "flex flex-col gap-2 p-6 text-left";
export const DIALOG_TITLE = "font-serif text-base leading-5 font-normal";
export const DIALOG_FOOTER = "flex-row items-center justify-end gap-2 px-6 pb-6";

/**
 * A refusal the operator can only acknowledge: an action the screen offered
 * cannot be taken on this record, and the text says why. Controlled by the
 * caller, which decides the refusal before or after asking the server.
 */
export function NoticeDialog({
  open,
  onOpenChange,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={DIALOG_CONTENT}>
        <AlertDialogHeader className={DIALOG_HEADER}>
          <AlertDialogTitle className={DIALOG_TITLE}>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={DIALOG_FOOTER}>
          {/* `px-2.5!`: the cancel primitive puts this className inside the
              Button's `asChild` slot, past tailwind-merge, so the size's
              `px-4` would otherwise win. */}
          <AlertDialogCancel className="px-2.5!">Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
