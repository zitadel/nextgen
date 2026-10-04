import { useEffect, useState } from "react";

import { DetailSection } from "@/components/detail-page";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/hooks/use-submit";

/**
 * The `Details` card of a resource whose one editable field is its name.
 *
 * The field follows `value`: a save re-runs the loader and an edit elsewhere
 * invalidates it, so the draft never outlives the record it was typed against.
 */
export function RenameCard({
  id,
  label,
  value,
  record,
  onSave,
  errorFallback,
  className,
}: {
  /** The input's id and name. */
  id: string;
  label: string;
  value: string;
  /** The loaded record; a new one resets the draft. */
  record: unknown;
  /** Saves the trimmed name and reloads the record. */
  onSave: (name: string) => Promise<void>;
  errorFallback: string;
  className?: string;
}) {
  const [name, setName] = useState(value);
  const trimmed = name.trim();
  const dirty = trimmed !== value;
  const save = useSubmit(() => onSave(trimmed), errorFallback);
  const { clearError } = save;

  useEffect(() => {
    setName(value);
    clearError();
  }, [value, record, clearError]);

  return (
    <DetailSection title="Details" className={className}>
      <div className="flex flex-col gap-4.5">
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            name={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
          />
        </Field>
        <FormError message={save.error} />
        <div className="flex justify-end">
          {/* Secondary, small: the resting Save is the secondary fill, which
              `disabled:opacity-50` dims. Primary stays a bright call to action
              even greyed out. */}
          <Button
            variant="secondary"
            size="sm"
            className="gap-1 px-2.5 text-xs"
            onClick={() => void save.run()}
            disabled={!dirty || trimmed === ""}
            loading={save.pending}
          >
            Save
          </Button>
        </div>
      </div>
    </DetailSection>
  );
}
