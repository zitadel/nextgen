import { AlertCircle, Loader2, UserRoundCog, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MetaItem } from "@/components/ui/meta-item";
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
} from "../lib/schema";
import { getConsoleProjectId } from "../runtime/runtime";

/** A schema plus the id needed to reference it in the created user's `schema`. */
interface SchemaOption {
  id: string;
  schema: UserSchema;
  name: string;
  summary: string;
}

// Long utility strings live as named constants so Tailwind's scanner sees the
// full literal (it never sees a concatenated fragment).
const SHEET = "w-full gap-0 p-0 sm:max-w-[520px]";
const HEADER = "flex-row items-center justify-between gap-0 px-6 py-5";
const TITLE = "font-serif text-xl leading-none font-normal";
const BODY = "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6";
const SECTION = "flex flex-col gap-4";
const LABEL = "font-serif text-sm leading-5 font-normal text-foreground";
// The design wraps the label in a row so a marker can sit beside it
// (`27843:12281`), rather than appending to the label text itself.
const LABEL_ROW = "flex w-full items-center gap-2";
// The footer sits on the page background rather than a raised surface so
// scrolling body content passes under it (Figma annotation on `727:63415`).
const FOOTER = "flex-row items-center justify-end gap-3 bg-background px-6 py-4";

/**
 * The Add user drawer (Figma `641:13005` — "User creation: drawer").
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
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className={SHEET}>
        {/* Remounted per opening so a cancelled draft never reappears. */}
        {open && <AddUserForm onCreated={onCreated} onClose={() => setOpen(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function AddUserForm({
  onCreated,
  onClose,
}: {
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [schemas, setSchemas] = useState<SchemaOption[] | undefined>(undefined);
  const [schemaId, setSchemaId] = useState<string | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  // const [projects, setProjects] = useState<ProjectOption[]>([]);
  // The design's resting state already shows one empty row.
  // const [access, setAccess] = useState<ProjectAccessRow[]>([{ roles: [] }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const projectId = getConsoleProjectId();
        const listed = (await api.listSchemas({ project_id: projectId })).schemas;
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
        if (!cancelled) setError(describeError(cause, "Could not load user schemas."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = schemas?.find((option) => option.id === schemaId);
  const fields = selected ? schemaFields(selected.schema) : [];
  const missingRequired = fields.some(
    (entry) => entry.required && !values[entry.key]?.trim(),
  );

  const selectSchema = useCallback((next: string) => {
    setSchemaId(next);
    // Values are keyed by property name and schemas do not share a namespace,
    // so a leftover value could be written to a property the new schema never
    // declared. Reset rather than merge.
    setValues({});
    setError(undefined);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || missingRequired || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
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
      await api.createUser(
        { schema: selected.id, attributes },
        { project_id: getConsoleProjectId() },
      );
      await onCreated();
      onClose();
    } catch (cause) {
      setError(describeError(cause, "Could not create the user."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className={HEADER}>
        <SheetTitle className={TITLE}>Add user</SheetTitle>
        <SheetClose
          className="cursor-pointer opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </SheetClose>
      </SheetHeader>
      <Separator />

      <div className={BODY}>
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
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}
      </div>

      <Separator />
      <SheetFooter className={FOOTER}>
        <Button
          type="button"
          variant="secondary"
          className="gap-1.5 px-2.5"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="gap-1 px-2.5 text-xs"
          disabled={!selected || missingRequired || submitting}
        >
          {submitting && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Add user
        </Button>
      </SheetFooter>
    </form>
  );
}

/** Searchable schema picker, composed from the shared Combobox. */
function SchemaPicker({
  id,
  schemas,
  selected,
  onSelect,
}: {
  id: string;
  schemas: SchemaOption[] | undefined;
  selected: SchemaOption | undefined;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const loading = schemas === undefined;

  return (
    <Combobox open={open} onOpenChange={setOpen}>
      <ComboboxAnchor asChild>
        <ComboboxTrigger
          label="User Schema"
          open={open}
          disabled={loading}
          className="w-full"
          addon={<UserRoundCog className="size-4" />}
          onOpen={() => setOpen(true)}
        >
          {selected ? (
            <ComboboxValue>{selected.name}</ComboboxValue>
          ) : (
            <ComboboxPlaceholder>
              {loading ? "Loading schemas…" : "Select schema"}
            </ComboboxPlaceholder>
          )}
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxContent
        options={(schemas ?? []).map((option) => ({
          value: option.id,
          label: option.name,
          description: option.summary || undefined,
        }))}
        selected={selected ? [selected.id] : []}
        searchPlaceholder="Search schemas"
        emptyLabel="No schemas found."
        onSelect={onSelect}
        onClose={() => setOpen(false)}
      />
    </Combobox>
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
        className="h-9 rounded-md px-2.5 py-1 text-sm"
      />
    </Field>
  );
}
