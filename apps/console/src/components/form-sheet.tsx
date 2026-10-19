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

/**
 * The right-side drawer a resource is added from (decisions log D15).
 *
 * `children` renders the form and is remounted per opening, so a cancelled
 * draft never reappears.
 */
export function FormSheet({
  trigger,
  children,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-130">
        {open && children(() => setOpen(false))}
      </SheetContent>
    </Sheet>
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
      <SheetHeader className="flex-row items-center justify-between gap-0 px-6 py-5">
        <SheetTitle className="font-serif text-xl leading-none font-normal">{title}</SheetTitle>
        <SheetClose
          className="cursor-pointer opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </SheetClose>
      </SheetHeader>
      <Separator />

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
