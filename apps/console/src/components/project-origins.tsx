import { Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SHEET_CHOICE_CARD } from "@/components/form-sheet";
import {
  DIALOG_CONTENT,
  DIALOG_FOOTER,
  DIALOG_HEADER,
  DIALOG_TITLE,
} from "@/components/notice-dialog";
import { OriginLink } from "@/components/origin-link";
import { RowMenu } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSubmit } from "@/hooks/use-submit";
import { describeError } from "@/lib/api-error";

type Origin = Awaited<ReturnType<typeof api.getProject>>["origins"][number];
type OriginKind = Origin["kind"];

/** The kinds in the order the form offers them and the rows take. */
const KINDS: OriginKind[] = ["primary", "preview"];

const KIND_LABEL: Record<OriginKind, string> = { primary: "Primary", preview: "Preview" };

/** What each kind is for, on its choice card. */
const KIND_SUMMARY: Record<OriginKind, string> = {
  primary: "Your app's live URLs",
  preview: "A pattern for preview deployments",
};

const KIND_PLACEHOLDER: Record<OriginKind, string> = {
  primary: "eg. https://app.acme.com",
  preview: "eg. https://*.preview.acme.com",
};

/** What each kind admits, under the URL field. */
const KIND_HINT: Record<OriginKind, string> = {
  primary: "The exact URL your app is served from, with no path.",
  preview: "Use * for the part that changes, like branch names.",
};

/** The form's body: the dialog's 24px inset, 16px between the fields. */
const FORM_BODY = "flex flex-col gap-4 px-6 pb-6";

/**
 * The project's origins: one row per pattern, its kind beside it, with an add,
 * an edit and a remove.
 *
 * The rows come with the project (`origins` on `project-response`), so this
 * section needs no read of its own. Each change is a request per pattern,
 * after which `onChanged` reloads the page's data: the list follows the
 * record rather than the console's idea of it.
 *
 * **The server owns the rules.** A primary pattern must be an exact URL and a
 * preview pattern may hold one wildcard label, but neither is checked here:
 * the form sends what was typed and shows the refusal's own message inline
 * (ADR 030), so the console never forks the validation.
 *
 * **An empty list is a state, not a gap.** The API admits every origin until
 * the first pattern is added, so the line in place of the rows says so.
 */
export function ProjectOrigins({
  projectId,
  origins,
  onChanged,
}: {
  projectId: string;
  origins: Origin[];
  /** Called after an origin was added, changed or removed, to reload the page's data. */
  onChanged: () => void;
}) {
  const rows = sortOrigins(origins);
  return (
    <DetailSection
      title="Origins"
      titleId="project-origins"
      titleStyle="heading"
      className="mt-4"
      role="region"
      aria-labelledby="project-origins"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No origins yet. Every origin is admitted until the first pattern is added.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((origin) => (
            <OriginRow
              key={origin.pattern}
              projectId={projectId}
              origin={origin}
              last={rows.length === 1}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <AddOriginDialog projectId={projectId} onChanged={onChanged}>
          <Button variant="outline" size="sm" className={CARD_ACTION_BUTTON}>
            <Plus aria-hidden />
            Add origin
          </Button>
        </AddOriginDialog>
      </div>
    </DetailSection>
  );
}

/** Primary patterns first, then by pattern, so a project's live origins lead. */
function sortOrigins(origins: Origin[]): Origin[] {
  const order: Record<OriginKind, number> = { primary: 0, preview: 1 };
  return [...origins].sort(
    (a, b) => order[a.kind] - order[b.kind] || a.pattern.localeCompare(b.pattern),
  );
}

/**
 * One origin: the kind as its label, the pattern as a link with a copy, and
 * the row menu holding Edit and Remove. A pattern with a wildcard
 * opens nothing, so it is drawn as text in the link's place rather than as a
 * dead link.
 */
function OriginRow({
  projectId,
  origin,
  last,
  onChanged,
}: {
  projectId: string;
  origin: Origin;
  /** Whether this is the project's only origin. */
  last: boolean;
  onChanged: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const isPattern = origin.pattern.includes("*");

  return (
    <li className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-center sm:gap-6">
      {/* 216px, less the gap: the value starts on the column the name field's
          input does. */}
      <span className="shrink-0 text-sm leading-5 text-muted-foreground sm:w-48">
        {KIND_LABEL[origin.kind]}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isPattern ? (
            <span className="truncate text-sm leading-5 text-foreground">{origin.pattern}</span>
          ) : (
            <OriginLink
              origin={origin.pattern}
              className="text-sm font-normal text-foreground"
              iconClassName="text-muted-foreground"
            />
          )}
          <CopyButton
            value={origin.pattern}
            label={`Copy ${origin.pattern}`}
            size="icon-xs"
            className="size-4 shrink-0"
          />
        </div>
        <RowMenu name={origin.pattern} size="icon-xs" contentClassName="w-50">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRemoveOpen(true)}>Remove</DropdownMenuItem>
        </RowMenu>
      </div>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className={DIALOG_CONTENT} aria-describedby={undefined}>
          <DialogHeader className={DIALOG_HEADER}>
            <DialogTitle className={DIALOG_TITLE}>Edit origin</DialogTitle>
          </DialogHeader>
          {editOpen && (
            <OriginForm
              projectId={projectId}
              current={origin}
              onChanged={onChanged}
              onClose={() => setEditOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <RemoveOriginDialog
        projectId={projectId}
        origin={origin}
        last={last}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onRemoved={onChanged}
      />
    </li>
  );
}

/** Add one pattern to the project. */
function AddOriginDialog({
  children,
  projectId,
  onChanged,
}: {
  children: ReactNode;
  projectId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/* 448px with the design's 24px rhythm, as the notice dialog. No
          description: the two choice cards say what each kind is for. */}
      <DialogContent className={DIALOG_CONTENT} aria-describedby={undefined}>
        <DialogHeader className={DIALOG_HEADER}>
          <DialogTitle className={DIALOG_TITLE}>Add origin</DialogTitle>
        </DialogHeader>
        {/* Remounted per opening so a cancelled attempt does not leave its
            pattern or its error behind. */}
        {open && (
          <OriginForm projectId={projectId} onChanged={onChanged} onClose={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The origin form: the kind as two choice cards, then the URL. With
 * `current` it edits that origin, otherwise it adds one. The kind decides
 * what the server accepts, so the field's placeholder and hint follow it.
 */
function OriginForm({
  projectId,
  current,
  onChanged,
  onClose,
}: {
  projectId: string;
  current?: Origin;
  /** Called once the project's origins changed, to reload them. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [kind, setKind] = useState<OriginKind>(current?.kind ?? "primary");
  const [pattern, setPattern] = useState(current?.pattern ?? "");
  // ADR 030: the refusal's own message is the human-facing string.
  const save = useSubmit(
    async () => {
      const next: Origin = { pattern: pattern.trim(), kind };
      if (current) {
        await replaceOrigin(projectId, current, next, onChanged);
      } else {
        await api.addOrigin(projectId, next);
      }
      toast.success(current ? "Origin edited" : "Origin added");
      onClose();
      onChanged();
    },
    current ? "The origin could not be changed." : "The origin could not be added.",
  );
  const { error } = save;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save.run();
  }

  return (
    // `contents`: the form is here for Enter-to-submit, the body and the
    // footer lay themselves out in the dialog's grid.
    <form className="contents" onSubmit={submit}>
      <div className={FORM_BODY}>
        <RadioGroup
          aria-label="Type"
          className="gap-2"
          value={kind}
          onValueChange={(value) => {
            setKind(value as OriginKind);
            save.clearError();
          }}
        >
          {KINDS.map((value) => {
            const id = `${inputId}-${value}`;
            return (
              <FieldLabel key={value} htmlFor={id} className={SHEET_CHOICE_CARD}>
                <Field orientation="horizontal" className="items-start">
                  <RadioGroupItem value={value} id={id} />
                  <FieldContent className="gap-1">
                    <FieldTitle className="leading-none font-medium">
                      {KIND_LABEL[value]}
                    </FieldTitle>
                    <FieldDescription className="leading-5">{KIND_SUMMARY[value]}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            );
          })}
        </RadioGroup>
        {/* A refusal makes the field invalid and takes the hint's place, and
          `aria-describedby` carries it: `Field` wires up no description of
          its own. */}
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={inputId}>URL</FieldLabel>
          <Input
            id={inputId}
            name="pattern"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={KIND_PLACEHOLDER[kind]}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : hintId}
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value);
              // The message described the pattern that was refused; editing makes
              // it a different one.
              save.clearError();
            }}
          />
          {error ? (
            <FieldError id={errorId}>{error}</FieldError>
          ) : (
            <FieldDescription id={hintId}>{KIND_HINT[kind]}</FieldDescription>
          )}
        </Field>
      </div>

      <DialogFooter className={DIALOG_FOOTER}>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.pending}>
          Cancel
        </Button>
        {/* Held while the server's refusal stands: the same request would be
            refused again. */}
        <Button
          type="submit"
          disabled={pattern.trim() === "" || error !== undefined}
          loading={save.pending}
        >
          {current ? "Save" : "Add origin"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * An edit is a remove and an add: the API keys origins by pattern and has no
 * update. The remove goes first. It is the more guarded of the two (an editor
 * may add but not remove), so a refusal there changes nothing, and the same
 * pattern cannot be held under two kinds. When the add is refused the
 * original is put back and the refusal shown, so the project ends as it
 * began; should that fail too, the page is reloaded and the message says
 * what is left. Between the two requests the origin is absent for a moment,
 * and a project whose only origin this is admits every origin for that
 * moment.
 */
async function replaceOrigin(
  projectId: string,
  current: Origin,
  next: Origin,
  onChanged: () => void,
): Promise<void> {
  if (next.pattern === current.pattern && next.kind === current.kind) return;
  await api.removeOrigin(projectId, { pattern: current.pattern });
  try {
    await api.addOrigin(projectId, next);
  } catch (refusal) {
    try {
      await api.addOrigin(projectId, current);
    } catch (cause) {
      onChanged();
      throw new Error(
        `${current.pattern} was removed, but could not be put back: ${describeError(cause, "the request failed")}`,
      );
    }
    throw refusal;
  }
}

/**
 * The remove confirmation. A primary origin's copy names the host whose
 * sign-ins stop; a preview pattern's says what can no longer register. The
 * project's only origin is different: without it the API admits every
 * origin, so the copy says that rather than promising a lockout.
 */
function RemoveOriginDialog({
  projectId,
  origin,
  last,
  open,
  onOpenChange,
  onRemoved,
}: {
  projectId: string;
  origin: Origin;
  last: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove origin?"
      description={
        last
          ? "This is the project's only origin. Without it every origin is admitted, until the next one is added."
          : origin.kind === "primary"
            ? `Sign-ins from this URL are rejected right away. Users on ${hostOf(origin.pattern)} can no longer log in.`
            : `Preview deploys can no longer register URLs under ${origin.pattern}. Live previews are untouched.`
      }
      action="Remove origin"
      fallback="The origin could not be removed."
      onConfirm={async () => {
        await api.removeOrigin(projectId, { pattern: origin.pattern });
        toast.success("Origin removed");
        onRemoved();
      }}
    />
  );
}

/** The host an exact origin names, or the origin itself when it does not parse. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
