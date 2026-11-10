import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/api/zitadel";
import { FormSheet, FormSheetForm, SHEET_SECTION } from "@/components/form-sheet";
import { SchemaFields, type SchemaFieldsLayout } from "@/features/schemas/components/schema-fields";
import { type SchemaOption, SchemaPicker } from "@/features/schemas/components/schema-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { useSchemaForm } from "@/features/schemas/use-schema-form";
import { useSubmit } from "@/hooks/use-submit";
import { describeError } from "@/lib/api-error";
import { useRequiredProjectScope } from "@/features/projects/project-scope";
import { fetchAllSchemas } from "@/features/schemas/api";
import { schemaDisplayName, schemaFieldSummary, schemaFields } from "@/features/schemas/model";
import {
  draftValue,
  formRoot,
  newDraft,
  unwritableMessage,
  unwritableRequired,
} from "@/features/schemas/schema-form";

// The design wraps the label in a row so a marker can sit beside it, rather
// than appending to the label text itself.
const LABEL_ROW = "flex w-full flex-wrap items-center gap-2";

const SHEET_LAYOUT: SchemaFieldsLayout = { orientation: "vertical", labelRow: LABEL_ROW };

/**
 * The Add user drawer.
 *
 * The form is **schema-driven**: `POST /users` takes an `attributes` object
 * validated against the user schema named in `schema`, so the controls below are
 * built from the chosen schema's `properties` rather than hardcoded. That is the
 * whole point of the screen — a project with a `minimal` schema asks only for an
 * email, a `business` one also asks for names and a company.
 *
 * The design also specifies a "Projects (optional)" block granting the new user
 * project roles. It is deliberately omitted rather than mocked: design removed
 * the project selector from the MVP (design decisions log D6, 2026-07-31) and
 * the grant endpoints do not exist (#419).
 */
export function AddUserSheet({
  children,
  onCreated,
}: {
  /** The trigger — the Users toolbar's `Add` button. */
  children: ReactNode;
  /** Called after a successful create so the caller can refresh its list. */
  onCreated: () => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children}>
      {(close) => <AddUserForm onCreated={onCreated} onClose={close} />}
    </FormSheet>
  );
}

function AddUserForm({
  onCreated,
  onClose,
}: {
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();
  const [schemas, setSchemas] = useState<SchemaOption[] | undefined>(undefined);
  const [schemaId, setSchemaId] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // One option per schema, not per edit: a superseded revision is not
        // something a new user should be created against, and offering the
        // same schema once per revision reads as duplicates.
        const options = (await fetchAllSchemas(projectId)).map(
          ({ id, schema }) =>
            ({
              id,
              schema,
              name: schemaDisplayName(schema, id),
              summary: schemaFieldSummary(schema),
            }) satisfies SchemaOption,
        );
        if (cancelled) return;
        setSchemas(options);
        // Preselect when there is no choice to make (the common case: one
        // project-wide schema), matching the design's preselected picker.
        const only = options.length === 1 ? options[0] : undefined;
        if (only) setSchemaId(only.id);
      } catch (cause) {
        if (!cancelled) setLoadError(describeError(cause, "Could not load user schemas."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const selected = schemas?.find((option) => option.id === schemaId);
  const root = useMemo(() => formRoot(selected ? schemaFields(selected.schema) : []), [selected]);
  // Values are keyed by property name and schemas do not share a namespace, so a
  // leftover value could be written to a property the new schema never declared.
  // A new schema starts a new draft rather than merging.
  const blank = useMemo(() => newDraft(root), [root]);
  const form = useSchemaForm(root, blank, "create");
  // Nothing this form sends can satisfy these, so say so rather than let it try.
  const unwritable = useMemo(
    () => unwritableRequired(root, form.draft, "create"),
    [root, form.draft],
  );

  const create = useSubmit(async () => {
    if (!selected) return;
    // Built from the field descriptors rather than the raw values so a
    // property's declared type survives (`attributeValue`).
    const attributes = draftValue(root, form.draft, "create") as Record<string, unknown>;
    try {
      await api.createUser({ schema: selected.id, attributes }, { project_id: projectId });
    } catch (cause) {
      form.applyServerError(cause);
      throw cause;
    }
    await onCreated();
    onClose();
  }, "Could not create the user.");

  const { clearError } = create;
  const selectSchema = useCallback(
    (next: string) => {
      setSchemaId(next);
      setLoadError(undefined);
      clearError();
    },
    [clearError],
  );

  return (
    <FormSheetForm
      title="Add user"
      submitLabel="Add user"
      canSubmit={Boolean(selected) && unwritable.length === 0}
      pending={create.pending}
      error={create.error ?? loadError ?? unwritableMessage(unwritable, "add this user")}
      noValidate
      onSubmit={() => {
        setLoadError(undefined);
        if (form.attemptSubmit()) void create.run();
      }}
      onClose={onClose}
    >
      <div className={SHEET_SECTION}>
        <Field>
          <div className={LABEL_ROW}>
            <FieldLabel>User Schema</FieldLabel>
          </div>
          <SchemaPicker
            id="user-schema"
            schemas={schemas}
            selected={selected}
            onSelect={selectSchema}
          />
        </Field>
        <Separator />
        <SchemaFields
          key={selected?.id}
          root={root}
          draft={form.draft}
          onChange={form.setDraft}
          form={form.controls}
          layout={SHEET_LAYOUT}
          disabled={create.pending}
        />
      </div>
    </FormSheetForm>
  );
}
