import { type ReactNode, useState } from "react";

import { api } from "@/api/zitadel";
import { FormSheet, FormSheetForm } from "@/components/form-sheet";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSubmit } from "@/hooks/use-submit";
import { useRequiredProjectScope } from "@/lib/project-scope";

/**
 * The Add team drawer.
 *
 * `POST /teams` takes a single `name`, and the design asks for exactly that —
 * one field, so this is not schema-driven the way the Add user drawer is. The
 * right-side sheet is D15 (adding a resource opens a drawer from the right).
 */
export function AddTeamSheet({
  children,
  onCreated,
}: {
  /** The trigger — the Teams toolbar's `Add` button. */
  children: ReactNode;
  /** Called after a successful create so the caller can refresh its list. */
  onCreated: () => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children}>
      {(close) => <AddTeamForm onCreated={onCreated} onClose={close} />}
    </FormSheet>
  );
}

function AddTeamForm({
  onCreated,
  onClose,
}: {
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();
  const [name, setName] = useState("");

  // ADR 030 makes the payload's `message` the human-facing string — most
  // importantly the 409 when the name is already taken, since `name` is unique
  // within the project.
  const create = useSubmit(async () => {
    await api.createTeam({ name: name.trim() }, { project_id: projectId });
    await onCreated();
    onClose();
  }, "Could not create the team.");

  return (
    <FormSheetForm
      title="Add team"
      submitLabel="Add team"
      canSubmit={name.trim() !== ""}
      pending={create.pending}
      error={create.error}
      onSubmit={() => void create.run()}
      onClose={onClose}
    >
      <Field>
        <FieldLabel className="text-foreground" htmlFor="team-name">
          Team name
        </FieldLabel>
        <Input
          id="team-name"
          name="team-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="eg. Acme"
          autoFocus
          required
          maxLength={200}
        />
      </Field>
    </FormSheetForm>
  );
}
