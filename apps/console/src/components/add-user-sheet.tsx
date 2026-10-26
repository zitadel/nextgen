import { ApiError } from "@zitadel/api/runtime/fetch";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";

import { api } from "@/api/zitadel";
import { FormSheet, FormSheetForm } from "@/components/form-sheet";
import { type SchemaOption, SchemaPicker } from "@/components/schema-picker";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FieldOptionalIndicator } from "@/components/ui/field-optional-indicator";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useSubmit } from "@/hooks/use-submit";
import { describeError, invalidFields } from "@/lib/api-error";
import { useRequiredProjectScope } from "@/lib/project-scope";
// Parked — design decisions log D6, plus no grant endpoints. See the block below.
// import {
//   ProjectAccess,
//   type ProjectAccessRow,
//   type ProjectOption,
// } from "./project-access";
import {
  attributeValue,
  fetchAllSchemas,
  inputAttributes,
  type SchemaField,
  schemaDisplayName,
  schemaFieldSummary,
  schemaFields,
} from "@/lib/schema";

const SECTION = "flex flex-col gap-4";
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
 *
 * Opened from a team, the drawer adds the user to it: `team` is the current
 * context, preselected and read-only (decisions log D15). It is sent as
 * `team_id`, which makes the new user a member of the team — not owned by it.
 * `POST /users` cannot set a lifecycle owner (ADR 024), so the user stays
 * self-owned whichever team they join.
 *
 * **A refused value is marked on its field.** The server names the attributes
 * a create failed on (`details.fields`) but not why, so each named field says
 * what its schema property expects, and the API's own message stays the
 * form's error. A field that is not on the form keeps its name in that message.
 */
export function AddUserSheet({
  children,
  team,
  onCreated,
}: {
  /** The trigger — the Users toolbar's `Add` button. */
  children: ReactNode;
  /** The team the new user joins, when the drawer is opened from one. */
  team?: { id: string; name: string };
  /** Called after a successful create so the caller can refresh its list. */
  onCreated: () => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children}>
      {(close) => <AddUserForm team={team} onCreated={onCreated} onClose={close} />}
    </FormSheet>
  );
}

function AddUserForm({
  team,
  onCreated,
  onClose,
}: {
  team?: { id: string; name: string };
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();
  const teamFieldId = useId();
  const [schemas, setSchemas] = useState<SchemaOption[] | undefined>(undefined);
  const [schemaId, setSchemaId] = useState<string | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  // const [projects, setProjects] = useState<ProjectOption[]>([]);
  // The design's resting state already shows one empty row.
  // const [access, setAccess] = useState<ProjectAccessRow[]>([{ roles: [] }]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  // The fields the last create was refused on, cleared field by field as they
  // are edited. `taken` is a 409: the values are valid, but another user holds
  // one the schema marks unique.
  const [refused, setRefused] = useState<{ keys: Set<string>; taken: boolean }>(NONE_REFUSED);

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
  const fields = useMemo(() => (selected ? schemaFields(selected.schema) : []), [selected]);
  const submittedValue = (entry: SchemaField) => fieldValue(entry, values[entry.key]);
  const missingRequired = fields.some((entry) => entry.required && !submittedValue(entry));

  // The message leaves out the fields the form marks itself, and keeps any it
  // has no control for, so no named field goes unmentioned.
  const describe = useCallback(
    (cause: unknown, fallback: string) => {
      const keys = new Set(fields.map((entry) => entry.key));
      return describeError(
        cause,
        fallback,
        invalidFields(cause).some((key) => !keys.has(key)),
      );
    },
    [fields],
  );

  const create = useSubmit(
    async () => {
      if (!selected) return;
      setRefused(NONE_REFUSED);
      // Built from the field descriptors rather than the raw values so a
      // property's declared type survives (`attributeValue`).
      const attributes: Record<string, unknown> = {};
      for (const entry of fields) {
        // Optional properties are omitted rather than sent empty: an empty
        // string fails format validation (`email`) instead of reading as absent.
        const value = submittedValue(entry);
        if (value === "") continue;
        attributes[entry.key] = attributeValue(entry, value);
      }
      try {
        await api.createUser(
          { schema: selected.id, attributes },
          { project_id: projectId, team_id: team?.id },
        );
      } catch (cause) {
        setRefused({
          keys: new Set(invalidFields(cause)),
          taken: cause instanceof ApiError && cause.status === 409,
        });
        throw cause;
      }
      await onCreated();
      onClose();
    },
    "Could not create the user.",
    describe,
  );

  const { clearError } = create;
  const selectSchema = useCallback(
    (next: string) => {
      setSchemaId(next);
      // Values are keyed by property name and schemas do not share a namespace,
      // so a leftover value could be written to a property the new schema never
      // declared. Reset rather than merge.
      setValues({});
      setRefused(NONE_REFUSED);
      setLoadError(undefined);
      clearError();
    },
    [clearError],
  );

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
        {team && (
          <Field>
            <div className={LABEL_ROW}>
              <FieldLabel htmlFor={teamFieldId}>Team</FieldLabel>
            </div>
            {/* Read-only, not a picker: the drawer was opened from this team,
                and the multi-select D1 describes has no endpoint to add a user
                to a second team yet. */}
            <Input id={teamFieldId} value={team.name} readOnly disabled />
          </Field>
        )}
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
        {fields.map((entry) => (
          <SchemaInput
            key={entry.key}
            field={entry}
            value={values[entry.key] ?? ""}
            refused={
              refused.keys.has(entry.key)
                ? refused.taken
                  ? "Another user already has this value."
                  : (entry.expects ?? "The user schema does not accept this value.")
                : undefined
            }
            onChange={(value) => {
              setValues((current) => ({ ...current, [entry.key]: value }));
              setRefused((current) => {
                if (!current.keys.has(entry.key)) return current;
                const keys = new Set(current.keys);
                keys.delete(entry.key);
                return { ...current, keys };
              });
            }}
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

const NONE_REFUSED = { keys: new Set<string>(), taken: false };

/**
 * The value a field submits: its text, trimmed. A required boolean the switch
 * was never moved on is `false`: its switch shows off, and off is a value. An
 * optional one stays unset until it is moved, so creating a user writes only
 * what was chosen.
 */
function fieldValue(entry: SchemaField, value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (text === "" && entry.inputType === "boolean" && entry.required) return "false";
  return text;
}

function SchemaInput({
  field,
  value,
  refused,
  onChange,
}: {
  field: SchemaField;
  value: string;
  /** Why the server refused this field's value, when it did. */
  refused?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <Field data-invalid={refused ? true : undefined}>
      <div className={LABEL_ROW}>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        {/* A sibling of the label, not part of it, so the accessible name stays
            the field name; requiredness itself reaches AT via `required`. */}
        {!field.required && <FieldOptionalIndicator />}
      </div>
      {field.inputType === "boolean" ? (
        // A switch, as the user profile edits a boolean: a text box would take
        // `yes`, which the schema refuses.
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={value === "true"}
            onCheckedChange={(checked) => onChange(String(checked))}
            // Not `required`: Radix backs the switch with a native checkbox,
            // and a required one blocks the submit while it is off.
            aria-invalid={refused ? true : undefined}
            aria-describedby={refused ? errorId : undefined}
          />
          {/* The switch reports its own state, so Yes/No is for the eye. */}
          <span className="text-foreground text-sm font-medium" aria-hidden>
            {value === "true" ? "Yes" : "No"}
          </span>
        </div>
      ) : (
        <Input
          id={id}
          name={field.key}
          {...inputAttributes(field)}
          required={field.required}
          placeholder={field.placeholder}
          value={value}
          aria-invalid={refused ? true : undefined}
          // `aria-invalid` says the field is wrong; this says why.
          aria-describedby={refused ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {refused && <FieldError id={errorId}>{refused}</FieldError>}
    </Field>
  );
}
