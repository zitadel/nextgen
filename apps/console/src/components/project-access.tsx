import { Box } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { MetaItem } from "@/components/ui/meta-item";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxChip,
  ComboboxChips,
  ComboboxContent,
  ComboboxPlaceholder,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";

/** A project the operator can grant access to. */
export interface ProjectOption {
  id: string;
  name: string;
}

/** One row of the block: a project, and the roles granted on it. */
export interface ProjectAccessRow {
  /** `undefined` until the operator picks a project. */
  projectId?: string;
  roles: string[];
}

const SECTION = "flex flex-col gap-2.5";
const LABEL = "font-serif text-sm leading-5 text-foreground";
// The section heading row uses a 10px gap, unlike the 8px on a Field label row.
const LABEL_ROW = "flex items-center gap-2.5";
const ROWS = "flex flex-col gap-2";
const ROW = "flex w-full items-center gap-2";
// 176px fixed (`w-44`): the design pins the project control so the roles control
// absorbs the remaining width.
const PROJECT_WIDTH = "w-44 shrink-0";
const ROLES_WIDTH = "min-w-0 flex-1";
const SMALL = "h-8 gap-1 px-2.5 text-xs";

/**
 * The "Projects (optional)" block from the Add user drawer
 * (Figma `702:3993` — the three annotated states).
 *
 * **`availableRoles` is empty in the app, by construction.** No endpoint serves a
 * role catalogue: ADR 034 places app roles in the app-group permission catalog,
 * which is unimplemented (epic #419). The multi-select the design specifies —
 * chips, accumulating checkmarks, a menu that stays open — is built and covered
 * by tests, but production passes no roles rather than inventing a vocabulary, so
 * the list opens honestly empty.
 *
 * Nothing here is sent on submit, and nothing is lost by that: `POST /users`
 * accepts no grants, and `queryProjects` remains scope-pinned until root ADR
 * 052's authorized-project query lands — the same project id the create call
 * already passes.
 */
export function ProjectAccess({
  projects,
  rows,
  onChange,
  availableRoles = [],
}: {
  /** Available projects; empty while loading or when the query failed. */
  projects: ProjectOption[];
  rows: ProjectAccessRow[];
  onChange: (rows: ProjectAccessRow[]) => void;
  /** Grantable roles. Empty until a role catalogue exists. */
  availableRoles?: string[];
}) {
  const labelId = useId();
  // Every project already has a row, so there is nothing left to add.
  const exhausted = projects.length === 0 || rows.length >= projects.length;
  const taken = new Set(rows.map((row) => row.projectId).filter(Boolean));

  const update = (index: number, next: Partial<ProjectAccessRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div className={SECTION} role="group" aria-labelledby={labelId}>
      <div className={LABEL_ROW}>
        <p id={labelId} className={LABEL}>
          Projects
        </p>
        <MetaItem>Optional</MetaItem>
      </div>

      {rows.length > 0 && (
        <div className={ROWS}>
          {rows.map((row, index) => (
            <div key={index} className={ROW}>
              <ProjectPicker
                value={row.projectId}
                // A project already on another row is not offered twice — the
                // design's result state is one row per project.
                options={projects.filter(
                  (project) => project.id === row.projectId || !taken.has(project.id),
                )}
                onSelect={(projectId) => update(index, { projectId })}
              />
              <RolePicker
                disabled={!row.projectId}
                available={availableRoles}
                selected={row.roles}
                onChange={(roles) => update(index, { roles })}
              />
              {/* `Row · empty` in the sheet carries no Remove — there is nothing
                  to take away until a project is chosen. */}
              {row.projectId && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={SMALL}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!exhausted && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={`${SMALL} self-start`}
          onClick={() => onChange([...rows, { roles: [] }])}
        >
          + Add project
        </Button>
      )}
    </div>
  );
}

function ProjectPicker({
  value,
  options,
  onSelect,
}: {
  value: string | undefined;
  options: ProjectOption[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((project) => project.id === value);

  return (
    <Combobox open={open} onOpenChange={setOpen}>
      <ComboboxAnchor asChild>
        <ComboboxTrigger
          label="Select project"
          open={open}
          className={PROJECT_WIDTH}
          addon={<Box className="size-4" />}
          onOpen={() => setOpen(true)}
        >
          {chosen ? (
            <ComboboxValue>{chosen.name}</ComboboxValue>
          ) : (
            <ComboboxPlaceholder>Select project</ComboboxPlaceholder>
          )}
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxContent
        options={options.map((project) => ({
          value: project.id,
          label: project.name,
          icon: <Box className="size-4" aria-hidden />,
        }))}
        selected={value ? [value] : []}
        searchPlaceholder="Search projects"
        emptyLabel="No projects available."
        // `Row · River` fills the chosen row rather than ticking it.
        indicator="fill"
        onSelect={onSelect}
        onClose={() => setOpen(false)}
      />
    </Combobox>
  );
}

/**
 * Roles multi-select. Disabled until a project is chosen (the design's resting
 * row renders it at 50% opacity), then accumulates selections as chips without
 * closing the menu — "Menu stays open, checkmarks accumulate".
 */
function RolePicker({
  disabled,
  available,
  selected,
  onChange,
}: {
  disabled: boolean;
  available: string[];
  selected: string[];
  onChange: (roles: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Combobox
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
      }}
    >
      <ComboboxAnchor asChild>
        <ComboboxTrigger
          label="Select roles"
          open={open}
          disabled={disabled}
          className={ROLES_WIDTH}
          onOpen={() => setOpen(true)}
        >
          {selected.length === 0 ? (
            <ComboboxPlaceholder>Select roles</ComboboxPlaceholder>
          ) : (
            <ComboboxChips>
              {selected.map((role) => (
                <ComboboxChip
                  key={role}
                  label={role}
                  onRemove={() => onChange(selected.filter((r) => r !== role))}
                />
              ))}
            </ComboboxChips>
          )}
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxContent
        options={available.map((role) => ({ value: role, label: role }))}
        selected={selected}
        searchPlaceholder="Search roles"
        emptyLabel="No roles available."
        closeOnSelect={false}
        onSelect={(role) =>
          onChange(
            selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role],
          )
        }
        onClose={() => setOpen(false)}
      />
    </Combobox>
  );
}
