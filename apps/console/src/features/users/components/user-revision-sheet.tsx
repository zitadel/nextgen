import { ApiError } from "@zitadel/api/runtime/fetch";
import { Check, ChevronRight, History, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@/api/zitadel";
import { AttributeFields } from "@/features/users/components/attribute-fields";
import {
  FormSheet,
  FormSheetForm,
  SHEET_LABEL_ROW,
  SHEET_LEGEND,
  SHEET_SECTION,
} from "@/components/form-sheet";
import { IdText } from "@/components/id-text";
import {
  REVISION_MENU,
  REVISION_TRIGGER,
  RevisionItems,
  RevisionValue,
} from "@/features/schemas/components/revision-select";
import { SchemaFields, type SchemaFieldsLayout } from "@/features/schemas/components/schema-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSchemaForm } from "@/features/schemas/use-schema-form";
import { useSubmit } from "@/hooks/use-submit";
import { describeError, errorFieldNames } from "@/lib/api-error";
import { useRequiredProjectScope } from "@/features/projects/project-scope";
import type { SchemaRevision, UserSchema, ValueField } from "@/features/schemas/model";
import {
  attributeJson,
  formRoot,
  refusedAt,
  revisionPatch,
  unwritableMessage,
  unwritableRequired,
} from "@/features/schemas/schema-form";
import {
  canTakeValue,
  isOlderRevision,
  planRevisionMove,
  type RemovedAttribute,
  revisionAttributes,
} from "@/features/users/revision-move";

const LABEL_ROW = "flex w-full flex-wrap items-center gap-2";
const SECTION_NOTE = "text-xs leading-4 text-muted-foreground";
/** One removed attribute: its name and stored value on a line, the switch at its end. */
const REMOVED_ROW =
  "flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2 text-sm";

/** What a moved user says. */
export const REVISION_UPDATED_MESSAGE = "Schema revision updated";

/** A stored value on one line, as text where it is text. */
function shownValue(value: unknown): string {
  return typeof value === "string" ? value : attributeJson(value);
}

/**
 * What the server says of moving a user to a revision, before anything is written.
 * A value it refuses is an expected answer, and a unique value another user holds
 * also comes with a message; anything else stops the move.
 */
async function dryRunMove(
  userId: string,
  schema: string,
): Promise<{ refused: string[]; message?: string }> {
  try {
    await api.patchUserByID(userId, { schema, dry_run: true });
    return { refused: [] };
  } catch (cause) {
    const refused = errorFieldNames(cause);
    if (!(cause instanceof ApiError) || refused.length === 0) throw cause;
    if (cause.status === 400) return { refused };
    if (cause.status === 409) {
      return { refused, message: describeError(cause, "A value is already taken.") };
    }
    throw cause;
  }
}

/**
 * The Update schema revision drawer: moves one user to another revision of their
 * schema, with what the move needs from their attributes in one request.
 *
 * It asks the server what the move needs, with a dry run for each revision picked,
 * so this form never judges a schema itself. The answer holds for that moment: a
 * refused move changes nothing, and a field the refusal names joins the form.
 */
export function UserRevisionSheet({
  children,
  userId,
  attributes,
  currentId,
  currentSchema,
  latestId,
  revisions,
  discardsEdits,
  onUpdated,
}: {
  /** The trigger. */
  children: ReactNode;
  userId: string;
  attributes: Record<string, unknown>;
  /** The revision the user is on. */
  currentId: string;
  currentSchema: UserSchema;
  latestId?: string;
  /** The schema's history, which the user's own revision is left out of as a target. */
  revisions: SchemaRevision[];
  /** Unsaved edits on the page, which the reload after a move resets. */
  discardsEdits: boolean;
  onUpdated: () => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children}>
      {(close) => (
        <RevisionForm
          userId={userId}
          attributes={attributes}
          currentId={currentId}
          currentSchema={currentSchema}
          latestId={latestId}
          revisions={revisions}
          discardsEdits={discardsEdits}
          onUpdated={onUpdated}
          onClose={close}
        />
      )}
    </FormSheet>
  );
}

function RevisionForm({
  userId,
  attributes,
  currentId,
  currentSchema,
  latestId,
  revisions,
  discardsEdits,
  onUpdated,
  onClose,
}: {
  userId: string;
  attributes: Record<string, unknown>;
  currentId: string;
  currentSchema: UserSchema;
  latestId?: string;
  revisions: SchemaRevision[];
  discardsEdits: boolean;
  onUpdated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();
  const pickerId = useId();
  const targets = useMemo(
    () => revisions.filter((revision) => revision.id !== currentId),
    [revisions, currentId],
  );
  const [targetId, setTargetId] = useState(() =>
    latestId && latestId !== currentId ? latestId : (targets[0]?.id ?? ""),
  );
  const [loaded, setLoaded] = useState<
    { id: string; schema: UserSchema; refused: string[] } | undefined
  >(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  // Fields a refusal named that the comparison had left out.
  const [named, setNamed] = useState<ReadonlySet<string>>(new Set());
  // The attributes the target would keep, that the administrator chose to remove.
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [leftUnchanged, setLeftUnchanged] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    Promise.all([
      api.getSchemaById(targetId, { project_id: projectId }),
      dryRunMove(userId, targetId),
    ])
      .then(([body, answer]) => {
        if (cancelled) return;
        setLoaded({ id: targetId, schema: body.schema as UserSchema, refused: answer.refused });
        if (answer.message) setLoadError(answer.message);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(describeError(cause, "Could not check this revision."));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, targetId, userId]);

  const answer = loaded?.id === targetId ? loaded : undefined;
  const target = answer?.schema;
  const move = useMemo(
    () => planRevisionMove(currentSchema, answer?.schema ?? {}, attributes, answer?.refused),
    [currentSchema, answer, attributes],
  );
  const { root, removed, kept, signInChanges } = move;
  const form = useSchemaForm(root, move.draft, "edit");
  const shownKeys = useMemo(() => new Set([...move.review, ...named]), [move.review, named]);
  // Only the shown fields are written; the form holds them all, so a field the
  // server names joins without losing what was typed.
  const shownRoot = useMemo(
    () =>
      formRoot(
        root.fields
          .filter((entry) => shownKeys.has(entry.key))
          .map((entry) => {
            const stored = attributes[entry.key];
            const showsStored =
              entry.kind === "value" && stored !== undefined && refusedAt(move.refused, entry.key);
            if (!showsStored) return entry;
            const currently = `Currently ${attributeJson(stored)}.`;
            const description = entry.description ? `${currently} ${entry.description}` : currently;
            return { ...entry, description };
          }),
      ),
    [root, shownKeys, attributes, move.refused],
  );
  const unwritable = useMemo(
    () => unwritableRequired(root, form.draft, "edit"),
    [root, form.draft],
  );

  const update = useSubmit(async () => {
    const patch = revisionAttributes(
      revisionPatch(shownRoot, attributes, form.draft, move.refused),
      removed.filter((entry) => entry.mustRemove || removing.has(entry.name)),
    );
    setLeftUnchanged(false);
    try {
      await api.patchUserByID(userId, {
        schema: targetId,
        ...(Object.keys(patch).length > 0 ? { attributes: patch } : {}),
      });
    } catch (cause) {
      // A refusal changes nothing. Past that, such as a lost connection, it may have.
      setLeftUnchanged(cause instanceof ApiError && cause.status < 500);
      const declared = new Set(root.fields.map((entry) => entry.key));
      setNamed(
        (previous) =>
          new Set([
            ...previous,
            ...errorFieldNames(cause)
              .map((name) => name.split(".")[0] ?? "")
              .filter((key) => declared.has(key)),
          ]),
      );
      form.applyServerError(cause);
      throw cause;
    }
    toast.success(REVISION_UPDATED_MESSAGE);
    onClose();
    await onUpdated();
  }, "Could not update the user.");

  const { clearError } = update;
  const pickTarget = useCallback(
    (next: string) => {
      setTargetId(next);
      setLoadError(undefined);
      setNamed(new Set());
      setRemoving(new Set());
      setLeftUnchanged(false);
      clearError();
    },
    [clearError],
  );
  const setRemovingOne = useCallback((name: string, on: boolean) => {
    setRemoving((previous) => {
      const next = new Set(previous);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const layout: SchemaFieldsLayout = {
    orientation: "vertical",
    labelRow: LABEL_ROW,
    // A rename can't be told from a removal and an addition, so it is offered.
    belowValue: (entry: ValueField, path: string, text: string, setText) => {
      // A row's path has its id in it: a value there can't be one attribute's new name.
      if (path !== entry.attributePath || text !== "") return null;
      return removed
        .filter((attribute) => !attribute.inArray && canTakeValue(entry, attribute.value))
        .map((attribute) => (
          <Button
            key={attribute.name}
            type="button"
            variant="link"
            size="xs"
            className="text-muted-foreground h-auto justify-start px-0 py-0 text-xs font-normal whitespace-normal"
            onClick={() => {
              setText(String(attribute.value));
              setRemovingOne(attribute.name, true);
            }}
          >
            Use “{shownValue(attribute.value)}” from {attribute.name}
          </Button>
        ));
    },
  };

  const keptCount = Object.keys(kept).length;
  const nothingNeeded = shownKeys.size === 0 && removed.length === 0;
  const mustRemove = removed.filter((entry) => entry.mustRemove);
  const mayRemove = removed.filter((entry) => !entry.mustRemove);
  const refusal =
    update.error && (leftUnchanged ? `${update.error} Nothing was changed.` : update.error);

  return (
    <FormSheetForm
      title="Update schema revision"
      submitLabel="Update user"
      canSubmit={target !== undefined && unwritable.length === 0}
      pending={update.pending}
      error={refusal ?? loadError ?? unwritableMessage(unwritable, "move this user")}
      noValidate
      onSubmit={() => {
        if (form.attemptSubmit()) void update.run();
      }}
      onClose={onClose}
    >
      <div className={SHEET_SECTION}>
        <Field>
          <div className={SHEET_LABEL_ROW}>
            <FieldLabel htmlFor={pickerId}>Move to</FieldLabel>
          </div>
          <Select value={targetId} onValueChange={pickTarget}>
            <SelectTrigger id={pickerId} className={`${REVISION_TRIGGER} w-full`}>
              <SelectValue>
                <RevisionValue revisions={targets} latestId={latestId} id={targetId} />
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4} align="start" className={REVISION_MENU}>
              <RevisionItems revisions={targets} latestId={latestId} />
            </SelectContent>
          </Select>
          <FieldDescription>
            Currently on{" "}
            <IdText id={currentId} title={currentId} className="inline-flex max-w-60" />. Moving
            this user doesn&rsquo;t change the revision new registrations use.
          </FieldDescription>
        </Field>

        {target === undefined ? (
          !loadError && <p className={SECTION_NOTE}>Loading revision…</p>
        ) : (
          <>
            {isOlderRevision(revisions, targetId, currentId) && (
              <Alert>
                <History aria-hidden />
                <AlertTitle>This is an older revision</AlertTitle>
                <AlertDescription>
                  It was created before the one this user is on. Attributes and rules added since
                  then won&rsquo;t apply to them.
                </AlertDescription>
              </Alert>
            )}

            {signInChanges.length > 0 && (
              <Alert>
                <TriangleAlert aria-hidden />
                <AlertTitle>This revision changes how users sign in</AlertTitle>
                <AlertDescription>
                  It differs in {signInChanges.join(", ")}. Zitadel doesn&rsquo;t block this move,
                  so check that this user can still sign in.
                </AlertDescription>
              </Alert>
            )}

            {nothingNeeded && (
              <p className="bg-muted/50 flex items-center gap-2 rounded-md px-3 py-2.5 text-sm">
                <Check aria-hidden className="size-4 shrink-0" />
                {keptCount > 0
                  ? "No changes needed. All attributes carry over."
                  : "No changes needed."}
              </p>
            )}

            {shownKeys.size > 0 && (
              <div className={SHEET_SECTION}>
                <h3 className={SHEET_LEGEND}>Set these attributes</h3>
                <SchemaFields
                  root={shownRoot}
                  draft={form.draft}
                  onChange={form.setDraft}
                  form={form.controls}
                  layout={layout}
                  disabled={update.pending}
                />
              </div>
            )}

            {mustRemove.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className={SHEET_LEGEND}>Will be removed</h3>
                {mustRemove.map((entry) => (
                  <RemovedRow key={entry.name} attribute={entry} />
                ))}
                <p className={SECTION_NOTE}>
                  This revision doesn&rsquo;t allow these. Moving back won&rsquo;t restore them.
                </p>
              </div>
            )}

            {mayRemove.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className={SHEET_LEGEND}>Not declared by this revision</h3>
                {mayRemove.map((entry) => (
                  <RemovedRow
                    key={entry.name}
                    attribute={entry}
                    removing={removing.has(entry.name)}
                    onRemovingChange={(on) => setRemovingOne(entry.name, on)}
                  />
                ))}
                <p className={SECTION_NOTE}>
                  These stay on the user unless you remove them. Moving back won&rsquo;t restore a
                  removed value.
                </p>
              </div>
            )}

            {keptCount > 0 && (
              <Collapsible className="group/kept flex flex-col gap-2">
                <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-sm">
                  <ChevronRight
                    aria-hidden
                    className="size-4 transition-transform group-data-[state=open]/kept:rotate-90"
                  />
                  {keptCount === 1
                    ? "1 attribute stays the same"
                    : `${keptCount} attributes stay the same`}
                </CollapsibleTrigger>
                <CollapsibleContent className="rounded-md border border-input">
                  <AttributeFields attributes={kept} schema={target} userId={userId} />
                </CollapsibleContent>
              </Collapsible>
            )}

            {discardsEdits && (
              <p className={SECTION_NOTE}>
                Your unsaved changes to this user&rsquo;s attributes will be discarded.
              </p>
            )}
          </>
        )}
      </div>
    </FormSheetForm>
  );
}

/** A removed attribute and its stored value, with a switch where keeping it is a choice. */
function RemovedRow({
  attribute,
  removing,
  onRemovingChange,
}: {
  attribute: RemovedAttribute;
  removing?: boolean;
  onRemovingChange?: (removing: boolean) => void;
}) {
  const value = shownValue(attribute.value);
  return (
    <div className={REMOVED_ROW}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-mono text-xs" title={attribute.name}>
          {attribute.name}
        </span>
        <span className="text-muted-foreground truncate text-xs" title={value}>
          {value}
        </span>
      </span>
      {onRemovingChange && (
        <span className="flex shrink-0 items-center gap-2 text-xs">
          <span aria-hidden>Remove</span>
          <Switch
            aria-label={`Remove ${attribute.name}`}
            checked={removing ?? false}
            onCheckedChange={onRemovingChange}
          />
        </span>
      )}
    </div>
  );
}
