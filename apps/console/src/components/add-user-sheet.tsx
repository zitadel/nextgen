import { type ReactNode, useCallback, useEffect, useId, useState } from "react";

import { api } from "@/api/zitadel";
import { FormSheet, FormSheetForm } from "@/components/form-sheet";
import { type SchemaOption, SchemaPicker } from "@/components/schema-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MetaItem } from "@/components/ui/meta-item";
import { Separator } from "@/components/ui/separator";
import { useSubmit } from "@/hooks/use-submit";
import { describeError } from "@/lib/api-error";
import { useRequiredProjectScope } from "@/lib/project-scope";
// Parked — design decisions log D6, plus no grant endpoints. See the block below.
// import {
//   ProjectAccess,
//   type ProjectAccessRow,
//   type ProjectOption,
// } from "./project-access";
import {
  type SchemaField,
  type UserSchema,
  schemaDisplayName,
  schemaFieldSummary,
  schemaFields,
} from "@/lib/schema";

const SECTION = "flex flex-col gap-4";
const LABEL = "text-foreground";
// The design wraps the label in a row so a marker can sit beside it, rather
// than appending to the label text itself.
const LABEL_ROW = "flex w-full items-center gap-2";

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
 * the grant endpoints do not exist (#419). D6 expects it back in a future
 * version, so the block and its component are parked, not deleted — see
 * issue #633.
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
  const [values, setValues] = useState<Record<string, string>>({});
  // const [projects, setProjects] = useState<ProjectOption[]>([]);
  // The design's resting state already shows one empty row.
  // const [access, setAccess] = useState<ProjectAccessRow[]>([{ roles: [] }]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // One option per schema, not per edit: a superseded revision is not
        // something a new user should be created against, and offering the
        // same schema once per revision reads as duplicates. The picker needs
        // every one of them, so it drains the cursor-paginated list rather
        // than showing whatever fits in one page.
        const listed: Awaited<ReturnType<typeof api.listSchemas>>["schemas"] = [];
        let pageToken: string | undefined;
        do {
          const page = await api.listSchemas({
            project_id: projectId,
            kind: "user-schema",
            revisions: "latest",
            limit: 100,
            page_token: pageToken,
          });
          listed.push(...page.schemas);
          pageToken = page.next_page_token ?? undefined;
        } while (pageToken);
        const options = listed.map((entry) => {
          const schema = entry.schema as UserSchema;
          return {
            id: entry.id,
            schema,
            name: schemaDisplayName(schema, entry.id),
            summary: schemaFieldSummary(schema),
          } satisfies SchemaOption;
        });
        if (cancelled) return;
        setSchemas(options);
        // Projects are a secondary concern: a failure here must not block user
        // creation, so it leaves the block empty rather than surfacing an error.
        // void api
        //   .queryProjects({})
        //   .then((result) => {
        //     if (cancelled) return;
        //     setProjects(result.projects.map((p) => ({ id: p.id, name: p.name })));
        //   })
        //   .catch(() => undefined);
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
  const fields = selected ? schemaFields(selected.schema) : [];
  const missingRequired = fields.some(
    (entry) => entry.required && !values[entry.key]?.trim(),
  );

  const create = useSubmit(async () => {
    if (!selected) return;
    // Built from the field descriptors rather than the raw values so a
    // property's declared type survives: an input always yields a string, but
    // JSON Schema validates a `number`/`integer` property against a JSON
    // number, and `"42"` would be rejected. A value that will not parse is
    // sent through untouched so the server explains why, rather than becoming
    // `NaN` — which `JSON.stringify` would silently turn into `null`.
    const attributes: Record<string, unknown> = {};
    for (const entry of fields) {
      // Optional properties are omitted rather than sent empty: an empty
      // string fails format validation (`email`) instead of reading as absent.
      const value = values[entry.key]?.trim() ?? "";
      if (value === "") continue;
      if (entry.inputType === "number") {
        const numeric = Number(value);
        attributes[entry.key] = Number.isFinite(numeric) ? numeric : value;
      } else {
        attributes[entry.key] = value;
      }
    }
    await api.createUser({ schema: selected.id, attributes }, { project_id: projectId });
    await onCreated();
    onClose();
  }, "Could not create the user.");

  const { clearError } = create;
  const selectSchema = useCallback((next: string) => {
    setSchemaId(next);
    // Values are keyed by property name and schemas do not share a namespace,
    // so a leftover value could be written to a property the new schema never
    // declared. Reset rather than merge.
    setValues({});
    setLoadError(undefined);
    clearError();
  }, [clearError]);

  return (
    <FormSheetForm
      title="Add user"
      submitLabel="Add user"
      canSubmit={Boolean(selected) && !missingRequired}
      pending={create.pending}
      error={create.error ?? loadError}
      onSubmit={() => {
        setLoadError(undefined);
        void create.run();
      }}
      onClose={onClose}
    >
      <div className={SECTION}>
          <Field>
            <div className={LABEL_ROW}>
              <FieldLabel className={LABEL}>User Schema</FieldLabel>
            </div>
            <SchemaPicker
              id="user-schema"
              schemas={schemas}
              selected={selected}
              onSelect={selectSchema}
            />
          </Field>
          <Separator />
          {fields.map((entry) => (
            <SchemaInput
              key={entry.key}
              field={entry}
              value={values[entry.key] ?? ""}
              onChange={(value) =>
                setValues((current) => ({ ...current, [entry.key]: value }))
              }
            />
          ))}
        </div>
        {/* Projects block — out of the MVP for two independent reasons, both of
            which must clear before it returns.

            Design removed the project selector (design decisions log D6,
            2026-07-31) and expects it back in a future version; the log's
            "project access" open question — how project ↔ team ↔ access relate
            — is what has to settle first.

            The backend could not honour it anyway: granting needs a role
            catalogue (ADR 034's app-group catalog, epic #419) and a
            multi-project scope, but `queryProjects` remains scope-pinned until
            root ADR 053 lands and `POST /users` accepts no ADR 054 grants, so
            the block could select things it could never save.

            The component, its unit spec and its e2e coverage are kept intact
            alongside this — restore all four together. */}
        {/* <Separator />
        <ProjectAccess projects={projects} rows={access} onChange={setAccess} /> */}
    </FormSheetForm>
  );
}

function SchemaInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <Field>
      <div className={LABEL_ROW}>
        <FieldLabel htmlFor={id} className={LABEL}>
          {field.label}
        </FieldLabel>
        {/* A sibling of the label, not part of it, so the accessible name stays
            the field name; requiredness itself reaches AT via `required`. */}
        {!field.required && <MetaItem>Optional</MetaItem>}
      </div>
      <Input
        id={id}
        name={field.key}
        type={field.inputType}
        required={field.required}
        placeholder={field.placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
