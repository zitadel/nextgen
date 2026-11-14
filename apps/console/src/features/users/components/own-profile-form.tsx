import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/api/zitadel";
import { consoleSessionProject, refreshSession } from "@/auth/session";
import { useSubmit } from "@/hooks/use-submit";
import { type ValueField, attributeValue, inputAttributes } from "@/features/schemas/model";

// The wide row is two equal halves, which is what lines the control up at the
// card's midpoint. `Field` sizes the label by its text instead, through a
// variant that out-specifies a plain utility, hence the important suffix.
export const LABEL_HALF = "@md/field-group:min-w-px @md/field-group:flex-[1_0_0]!";
export const ROW = "@md/field-group:items-center!";
// A sign-in method's heading inside the card, on the rows' 24px inset.
export const METHOD_HEAD = "px-6 pt-5 text-sm font-medium text-foreground";

export function textRow(key: string, label: string, required: boolean): ValueField {
  return {
    kind: "value",
    key,
    attributePath: key,
    label,
    required,
    inputType: "text",
    integer: false,
    nullable: false,
    trim: true,
    rules: {},
  };
}

/** The editable rows and Save, starting from the saved values. */
export function ProfileForm({
  fields,
  saved,
}: {
  fields: ValueField[];
  saved: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(saved);
  const changed = fields.filter((entry) => (values[entry.key] ?? "").trim() !== saved[entry.key]);
  const missingRequired = fields.some(
    (entry) => entry.required && (values[entry.key] ?? "").trim() === "",
  );

  const save = useSubmit(async () => {
    const patch: Record<string, unknown> = {};
    for (const entry of changed) {
      const value = (values[entry.key] ?? "").trim();
      // Cleared means deleted (`null`), not an empty string — which would fail
      // a `format` and reads as a value rather than its absence.
      patch[entry.key] = value === "" ? null : attributeValue(entry, value);
    }
    await api.updateMyUser({ attributes: patch }, consoleSessionProject());
    // The account menu renders the session's `display`; drop the cached
    // session (only it: the CSRF token and the other cached reads still hold)
    // so a changed name shows without waiting out the cache.
    refreshSession();
    await router.invalidate();
  }, "Could not save your profile.");

  return (
    <>
      {fields.map((entry) => (
        <ProfileRow
          key={entry.key}
          field={entry}
          value={values[entry.key] ?? ""}
          onChange={(value) => setValues((current) => ({ ...current, [entry.key]: value }))}
          onEnter={() => {
            if (changed.length > 0 && !missingRequired) void save.run();
          }}
        />
      ))}
      <div className="flex flex-col gap-2">
        <FormError message={save.error} />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save.run()}
            disabled={changed.length === 0 || missingRequired}
            loading={save.pending}
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

export function ProfileRow({
  field: entry,
  value,
  readOnly = false,
  onChange,
  onEnter,
}: {
  field: ValueField;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onEnter?: () => void;
}) {
  const id = useId();

  return (
    <Field orientation="responsive" className={ROW}>
      <FieldLabel htmlFor={id} className={LABEL_HALF}>
        {entry.label}
      </FieldLabel>
      <FieldContent>
        <Input
          id={id}
          name={entry.key}
          {...inputAttributes(entry)}
          value={value}
          placeholder={
            readOnly
              ? entry.inputType === "email"
                ? "No email address"
                : "Not set"
              : (entry.placeholder ?? (entry.required ? undefined : "Optional"))
          }
          disabled={readOnly}
          readOnly={readOnly}
          required={!readOnly && entry.required}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter?.();
          }}
        />
      </FieldContent>
    </Field>
  );
}

/** The property types a text input can show and save back unchanged. */
export const EDITABLE_TYPES = new Set(["string", "number", "integer"]);
