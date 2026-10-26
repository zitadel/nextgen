import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/** A section of a drawer form: its fields 16px apart. */
export const SHEET_SECTION = "flex flex-col gap-4";
// The design wraps the label in a row so a marker can sit beside it, rather
// than appending to the label text itself.
export const SHEET_LABEL_ROW = "flex w-full items-center gap-2";
/**
 * The field label's face, on a legend. The legend keeps
 * its own 12px under it: a `legend` sits outside the fieldset's flex gap.
 */
export const SHEET_LEGEND = "font-serif text-sm leading-5 font-normal";
/**
 * A choice card: the label's own card
 * styling, at the design's 12px inset. `p-3!`: the label's `[&>*]:data-[slot=field]:p-4` is a variant
 * and out-specifies a plain `p-3`. The chosen card keeps the input border; the
 * label's own `border-primary` is a solid highlight the design does not draw.
 * The card's text is the sans face: the label it sits in is the display face,
 * which its children would inherit.
 */
export const SHEET_CHOICE_CARD =
  "font-sans has-data-[state=checked]:border-input [&>*]:data-[slot=field]:p-3!";

/**
 * The right-side drawer a resource is added from (decisions log D15).
 *
 * `children` renders the form and is remounted per opening, so a cancelled
 * draft never reappears.
 *
 * Opened by its `trigger`, or, without one, by the caller through `open` and
 * `onOpenChange`: for a trigger inside a popover, which unmounts with it.
 */
export function FormSheet({
  trigger,
  open: openProp,
  onOpenChange,
  children,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-130">
        {open && children(() => setOpen(false))}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The drawer's title and close, ruled off from the body beneath. 56px with the
 * rule inside it, as the top bar is, so the two rules meet in one line across
 * the drawer's edge.
 */
export function FormSheetHeader({ title }: { title: string }) {
  return (
    <SheetHeader className="h-14 shrink-0 flex-row items-center justify-between gap-0 border-b border-border px-6 py-0">
      <SheetTitle className="font-serif text-xl leading-none font-normal">{title}</SheetTitle>
      <SheetClose
        className="cursor-pointer opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label="Close"
      >
        <X className="size-5" aria-hidden />
      </SheetClose>
    </SheetHeader>
  );
}

/** The drawer's form: title and close, the scrolling body, then Cancel and submit. */
export function FormSheetForm({
  title,
  submitLabel,
  canSubmit,
  pending,
  error,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  submitLabel: string;
  canSubmit: boolean;
  pending: boolean;
  error?: string;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <FormSheetHeader title={title} />

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        {children}
        <FormError message={error} />
      </div>

      <Separator />
      {/* On the page background rather than a raised surface, so scrolling body
          content passes under it. */}
      <SheetFooter className="flex-row items-center justify-end gap-3 bg-background px-6 py-4">
        <Button type="button" variant="secondary" className="gap-1.5 px-2.5" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="gap-1 px-2.5 text-xs"
          disabled={!canSubmit}
          loading={pending}
        >
          {submitLabel}
        </Button>
      </SheetFooter>
    </form>
  );
}
