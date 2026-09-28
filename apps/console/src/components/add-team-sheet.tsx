import { AlertCircle, Loader2, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

import { api } from "../api/zitadel";
import { describeError } from "../lib/api-error";
import { getConsoleProjectId } from "../runtime/runtime";

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment). Shared with the Add user
// drawer, which the design draws as the same sheet.
const SHEET = "w-full gap-0 p-0 sm:max-w-[520px]";
const HEADER = "flex-row items-center justify-between gap-0 px-6 py-5";
const TITLE = "font-serif text-xl leading-none font-normal";
const BODY = "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6";
const LABEL = "font-serif text-sm leading-5 font-normal text-foreground";
// The footer sits on the page background rather than a raised surface so
// scrolling body content passes under it.
const FOOTER = "flex-row items-center justify-end gap-3 bg-background px-6 py-4";

/**
 * The Add team drawer.
 *
 * `POST /teams` takes a single `name`, and the design asks for exactly that —
 * one field, so this is not schema-driven the way the Add user drawer is. The
 * right-side sheet is D15 (adding a resource opens a drawer from the right).
 */
export function AddTeamSheet({
  children,
  onCreated,
}: {
  /** The trigger — the Teams toolbar's `Add` button. */
  children: ReactNode;
  /** Called after a successful create so the caller can refresh its list. */
  onCreated: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className={SHEET}>
        {/* Remounted per opening so a cancelled draft never reappears. */}
        {open && <AddTeamForm onCreated={onCreated} onClose={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function AddTeamForm({
  onCreated,
  onClose,
}: {
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const empty = name.trim() === "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (empty || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api.createTeam({ name: name.trim() }, { project_id: getConsoleProjectId() });
      await onCreated();
      onClose();
    } catch (cause) {
      // ADR 030 makes the payload's `message` the human-facing string — most
      // importantly the 409 when the name is already taken, since `name` is
      // unique within the project.
      setError(describeError(cause, "Could not create the team."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className={HEADER}>
        <SheetTitle className={TITLE}>Add team</SheetTitle>
        <SheetClose
          className="focus-visible:ring-ring/50 cursor-pointer opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:outline-none"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </SheetClose>
      </SheetHeader>
      <Separator />

      <div className={BODY}>
        <Field>
          <FieldLabel className={LABEL} htmlFor="team-name">
            Team name
          </FieldLabel>
          <Input
            id="team-name"
            name="team-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="eg. Acme"
            autoFocus
            required
            maxLength={200}
          />
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
      </div>

      <Separator />
      <SheetFooter className={FOOTER}>
        <Button type="button" variant="secondary" className="gap-1.5 px-2.5" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="gap-1 px-2.5 text-xs" disabled={empty || submitting}>
          {submitting && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Add team
        </Button>
      </SheetFooter>
    </form>
  );
}
