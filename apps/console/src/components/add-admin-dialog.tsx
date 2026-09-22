import { useRouteContext } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { api } from "../api/zitadel";
import { describeError } from "../lib/api-error";
import { getConsoleProjectId } from "../runtime/runtime";

/**
 * Give somebody admin access to this project by their email address (#1236,
 * journey in #769).
 *
 * **The field holds the designated identifier.** A schema designates which
 * property identifies a user (ADR 058); in the default schema that is the email
 * address, which is what the label says and what `type="email"` validates.
 *
 * **The answer is always the same.** `POST /grants` with `user.identifier`
 * answers 202 with no body whatever the address turns out to be — a hit, a
 * miss, a duplicate or an ambiguous lookup (#1229). There is nothing to branch
 * on, so the console never does: every accepted submit shows
 * `NEUTRAL_MESSAGE`. That is the point — an operator cannot use this field to
 * find out who has an account.
 *
 * **The one exception is the operator's own address**, which the API refuses
 * outright rather than neutrally. The console checks for it before sending, so
 * the answer names the mistake instead of claiming a grant that was not made.
 * Signed in without an identifier there is nothing to compare against, and the
 * API's own `grant.invalid` message comes back inline instead.
 *
 * **The list read is how the result becomes visible.** `onAdded` refreshes the
 * screen behind the dialog, so a grant that was really created shows up as a
 * row; one that was not, does not.
 */
export function AddAdminDialog({ children, onAdded }: { children: ReactNode; onAdded: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/* 384px, matching the remove dialog and the frame. The important suffix
          beats the primitive's own `sm:max-w-lg`. */}
      <DialogContent className="sm:max-w-sm!">
        <DialogHeader>
          <DialogTitle>Add admin</DialogTitle>
          <DialogDescription>
            They get full administrative access to this project. They need to have signed up
            already.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per opening so a cancelled attempt does not leave its
            address or its error behind. */}
        {open && (
          <AddAdminForm
            onDone={() => {
              setOpen(false);
              onAdded();
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What every accepted submit says, whoever the address belongs to. */
export const NEUTRAL_MESSAGE =
  "If the user exists in our system, they have been granted access to your project.";

/** What the operator's own address gets instead, since the API refuses it. */
export const SELF_MESSAGE =
  "You already have access to this project. Enter a colleague's address.";

function AddAdminForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { session } = useRouteContext({ from: "/_authed" });
  const self = session.user?.identifier;
  const inputId = useId();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    // The browser has already refused a malformed address by this point:
    // `type="email"` and `required` are the format check, so there is no
    // console-authored format message to keep in step with the server's.
    event.preventDefault();
    const identifier = value.trim();
    if (self && identifier.toLowerCase() === self.trim().toLowerCase()) {
      setError(SELF_MESSAGE);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await api.createGrant(
        { user: { identifier }, relation: "admin" },
        { project_id: getConsoleProjectId() },
      );
      toast(NEUTRAL_MESSAGE);
      onDone();
    } catch (cause) {
      // ADR 030: the refusal's own message is the human-facing string.
      setError(describeError(cause, "The admin could not be added."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // `contents` keeps the dialog's own column spacing: the form is here for
    // native validation and Enter-to-submit, not as a layout box.
    <form className="contents" onSubmit={(event) => void submit(event)}>
      {/* A refusal makes the field invalid, not just the text below it: the
          `Input` and the `Field` both carry their own styling for that state,
          and `aria-invalid` is what ties the message to the control. */}
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={inputId}>Email address</FieldLabel>
        <Input
          id={inputId}
          name="identifier"
          type="email"
          required
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <FieldError>{error}</FieldError>
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={value.trim() === "" || submitting}>
          {submitting && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Add admin
        </Button>
      </DialogFooter>
    </form>
  );
}
