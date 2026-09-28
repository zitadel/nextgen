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

/**
 * A destructive confirmation — Figma `Alert Dialog` as the Settings frames draw
 * it (Revoke invite 1858:30642, Remove admin 1705:11212): 384px, `rounded-xl`,
 * page background with a `foreground/10` edge; title in the display face at
 * 18/28, muted 14/20 body 6px under it; Cancel (outline) and the tinted
 * destructive action, right-aligned 8px apart. Opened by state so a row menu
 * can close before it shows.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The destructive button's label, e.g. `Revoke invite`. */
  action: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-6 rounded-xl border-foreground/10 sm:max-w-sm!">
        <AlertDialogHeader className="gap-1.5">
          <AlertDialogTitle className="font-serif text-lg leading-7 font-normal">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="leading-5">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="px-2.5!">Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            className="px-2.5"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
