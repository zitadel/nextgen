import { useEffect, useState } from "react";

import { CARD_ACTION_BUTTON, DetailSection } from "@/components/detail-page";
import { cn } from "@/lib/utils";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/hooks/use-submit";

/**
 * The details card of a resource whose one editable field is its name.
 *
 * The field follows `value`: a save re-runs the loader, and the draft resets
 * when the saved name changes. `layout="inline"` puts the label on a 202px
 * rail beside the input, as the project's card draws it, and stacks them
 * below `sm` where the rail would leave the input no room; the default
 * stacks them always.
 */
export function RenameCard({
  id,
  title = "Details",
  layout = "stacked",
  label,
  value,
  onSave,
  errorFallback,
  className,
}: {
  /** The input's id and name. */
  id: string;
  title?: string;
  layout?: "stacked" | "inline";
  label: string;
  value: string;
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
  }, [value, clearError]);

  return (
    <DetailSection title={title} className={className}>
      <div className="flex flex-col gap-4.5">
        <Field
          orientation={layout === "inline" ? "horizontal" : "vertical"}
          className={cn(
            layout === "inline" && "flex-col items-stretch sm:flex-row sm:items-center",
          )}
        >
          <FieldLabel htmlFor={id} className={cn(layout === "inline" && "flex-none! sm:w-[202px]")}>
            {label}
          </FieldLabel>
          <Input
            id={id}
            name={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            className={cn(layout === "inline" && "min-w-0 flex-1")}
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
            className={CARD_ACTION_BUTTON}
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
