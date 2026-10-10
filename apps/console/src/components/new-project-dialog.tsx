import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSubmit } from "@/hooks/use-submit";
import { createProjectInRegion } from "@/lib/cloud-projects";
import type { ConsoleRegion } from "@/runtime/runtime";

/**
 * Create a project in a region (platform mode, Console ADR 0004 §6).
 *
 * The one place the console creates a project. A project lives in the region
 * it is created in, so the region is chosen here and cannot change later; the
 * first region is preselected, the list is the runtime document's. The
 * creation is the public create followed by the claim (`lib/cloud-projects.ts`),
 * so the new project is the person's as soon as the dialog closes.
 */
export function NewProjectDialog({
  children,
  regions,
  onCreated,
}: {
  children: ReactNode;
  regions: readonly ConsoleRegion[];
  onCreated: (project: { id: string; region: ConsoleRegion }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm!">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project lives in the region it is created in, with its users and their data.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per opening, so a cancelled attempt leaves nothing behind. */}
        {open && (
          <NewProjectForm
            regions={regions}
            onDone={(project) => {
              setOpen(false);
              onCreated(project);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewProjectForm({
  regions,
  onDone,
  onCancel,
}: {
  regions: readonly ConsoleRegion[];
  onDone: (project: { id: string; region: ConsoleRegion }) => void;
  onCancel: () => void;
}) {
  const nameId = useId();
  const regionId = useId();
  const errorId = `${nameId}-error`;
  const [name, setName] = useState("");
  const [regionKey, setRegionKey] = useState(regions[0]?.id ?? "");
  const region = regions.find((candidate) => candidate.id === regionKey);
  const create = useSubmit(async () => {
    if (!region) throw new Error("Choose a region.");
    const project = await createProjectInRegion(region, name.trim());
    toast(`Project created in ${region.name}.`);
    onDone({ id: project.id, region });
  }, "Could not create the project.");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === "") {
      create.setError("Give the project a name.");
      return;
    }
    void create.run();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field data-invalid={create.error ? true : undefined}>
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            create.clearError();
          }}
          autoFocus
          aria-invalid={create.error ? true : undefined}
          aria-describedby={create.error ? errorId : undefined}
        />
        {create.error && <FieldError id={errorId}>{create.error}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor={regionId}>Region</FieldLabel>
        <Select value={regionKey} onValueChange={setRegionKey}>
          <SelectTrigger id={regionId} className="w-full">
            <SelectValue placeholder="Choose a region" />
          </SelectTrigger>
          <SelectContent>
            {regions.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={create.pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.pending}>
          Create project
        </Button>
      </DialogFooter>
    </form>
  );
}
