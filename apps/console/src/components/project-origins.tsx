import { Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { CARD_ACTION_BUTTON, DetailRow, DetailSection } from "@/components/detail-page";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FORM_DIALOG_BODY, FormDialog, FormDialogFooter } from "@/components/form-dialog";
import { SHEET_CHOICE_CARD } from "@/components/form-sheet";
import { OriginLink } from "@/components/origin-link";
import { RowMenu } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
import { KIND_LABEL } from "@/lib/deployment";

type Origin = Awaited<ReturnType<typeof api.getProject>>["origins"][number];
type OriginKind = Origin["kind"];

/** The kinds in the order the form offers them and the rows take. */
const KINDS: OriginKind[] = ["primary", "preview"];

/** What each kind is for, on its choice card. */
const KIND_SUMMARY: Record<OriginKind, string> = {
  primary: "Your app's live URL",
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
 * **An empty list is a state, not a gap.** The API admits only loopback origins
 * until the first pattern is added, so the line in place of the rows says so.
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
  const [addOpen, setAddOpen] = useState(false);
  const rows = sortOrigins(origins);
  return (
    <DetailSection
      title="Origins"
      titleId="project-origins"
      role="region"
      aria-labelledby="project-origins"
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No origins yet. Only a loopback origin is admitted until the first pattern is added.
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
        <OriginDialog
          projectId={projectId}
          open={addOpen}
          onOpenChange={setAddOpen}
          onChanged={onChanged}
          trigger={
            <Button variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
              <Plus aria-hidden />
              Add origin
            </Button>
          }
        />
      </div>
    </DetailSection>
  );
}

/** Primary patterns first, then by pattern, so a project's live origins lead. */
function sortOrigins(origins: Origin[]): Origin[] {
  return [...origins].sort(
    (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.pattern.localeCompare(b.pattern),
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
    <DetailRow as="li" align="center" divider label={KIND_LABEL[origin.kind]}>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isPattern ? (
            // The link's icon and gap as a spacer, so the text keeps the
            // linked rows' column.
            <span className="flex min-w-0 items-center gap-1 text-sm leading-5 text-foreground">
              <span aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{origin.pattern}</span>
            </span>
          ) : (
            <OriginLink
              origin={origin.pattern}
              className="text-sm font-normal text-foreground"
              iconClassName="text-muted-foreground"
            />
          )}
          <CopyButton value={origin.pattern} label={`Copy ${origin.pattern}`} size="inline" />
        </div>
        <RowMenu name={origin.pattern} size="icon-xs" contentClassName="w-50">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
            Remove
          </DropdownMenuItem>
        </RowMenu>
      </div>
      <OriginDialog
        projectId={projectId}
        current={origin}
        open={editOpen}
        onOpenChange={setEditOpen}
        onChanged={onChanged}
      />
      <RemoveOriginDialog
        projectId={projectId}
        origin={origin}
        last={last}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onRemoved={onChanged}
      />
    </DetailRow>
  );
}

/**
 * Add a pattern to the project, or with `current` change that one. No
 * description under the title: the two choice cards say what each kind is
 * for.
 */
function OriginDialog({
  projectId,
  current,
  trigger,
  open,
  onOpenChange,
  onChanged,
}: {
  projectId: string;
  current?: Origin;
  trigger?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title={current ? "Edit origin" : "Add origin"}
    >
      <OriginForm
        projectId={projectId}
        current={current}
        onChanged={onChanged}
        onClose={() => onOpenChange(false)}
      />
    </FormDialog>
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
  const next: Origin = { pattern: pattern.trim(), kind };
  const dirty = !current || next.pattern !== current.pattern || next.kind !== current.kind;
  // ADR 030: the refusal's own message is the human-facing string.
  const save = useSubmit(
    async () => {
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
      <div className={FORM_DIALOG_BODY}>
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

      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.pending}>
          Cancel
        </Button>
        {/* Held while nothing would change, and while the server's refusal
            stands: the same request would be refused again. */}
        <Button
          type="submit"
          disabled={!dirty || next.pattern === "" || error !== undefined}
          loading={save.pending}
        >
          {current ? "Save" : "Add origin"}
        </Button>
      </FormDialogFooter>
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
 * and a project whose only origin this is refuses it for that moment.
 */
async function replaceOrigin(
  projectId: string,
  current: Origin,
  next: Origin,
  onChanged: () => void,
): Promise<void> {
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
 * project's only origin is different: without it the API admits only loopback
 * origins, so the copy says that.
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
          ? "This is the project's only origin. Without it only a loopback origin is admitted, until the next one is added."
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
