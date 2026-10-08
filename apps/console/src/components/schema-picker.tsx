import { UserRoundCog } from "lucide-react";
import { useState } from "react";

import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import type { UserSchema } from "@/lib/schema";

/** A schema plus the id needed to reference it in the created user's `schema`. */
export interface SchemaOption {
  id: string;
  schema: UserSchema;
  name: string;
  summary: string;
}

/** Searchable schema picker, composed from the shared Combobox. */
export function SchemaPicker({
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
          id={id}
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
