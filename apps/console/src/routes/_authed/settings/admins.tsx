import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Ellipsis, Plus, UserRound } from "lucide-react";
import { useId, useState } from "react";

import { AddAdminDialog } from "@/components/add-admin-dialog";
import { RemoveAdminDialog } from "@/components/remove-admin-dialog";
import {
  RESOURCE_CELL,
  RESOURCE_PAGE,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { api } from "../../../api/zitadel";

/**
 * Settings → Admins: who administers each of your projects, and how that access
 * is given and taken away (#1025, journey in #769).
 *
 * **One section per project, never the console's own.** The projects come from
 * `GET /users/me/projects` (root ADR 053 §6): the ones the signed-in person can
 * act on, whether they claimed them or somebody granted them access. The
 * console's platform project is not among them and is not what anyone means
 * here, so `getConsoleProjectId()` has no business on this screen (#1238). Each
 * section reads, adds and removes against its own project id; there is no
 * selected-project state.
 *
 * **The owner is not a row.** Their access comes through the owning team, not
 * an admin grant, so a freshly claimed project lists nobody — and removing the
 * last granted admin just returns it to that state. The owning team keeps the
 * project manageable; deactivating *that* is the lockout path, and #1231 guards
 * it.
 *
 * **Not an invite flow.** The design draws `Invite`, a `Pending` status and
 * revoke/resend actions, but a grant is only ever created against a person who
 * already exists: `POST /grants` takes a user locator, and the grant resource
 * carries no status field, so there is no pending state to render and nothing
 * to revoke before signup. #769 says the same in its scope — the colleague signs
 * up through a separately shared link, and access is given afterwards. The
 * button therefore adds an existing person rather than inviting a new one.
 *
 * **`admin` only, by design.** The catalog defines `viewer` and `editor` too,
 * and the table renders whichever relation a grant carries, but this screen
 * only ever creates `admin`: #769 puts other access levels out of scope.
 */
export const Route = createFileRoute("/_authed/settings/admins")({
  staticData: {
    nav: { label: "Admins", order: 1, icon: UserRound, view: "settings", group: "WORKSPACE" },
  },
  loader: async () => {
    const page = await api.listMyProjects({ limit: PROJECTS_LIMIT });
    const sections = await Promise.all(
      page.projects.map(async (project): Promise<ProjectSection> => {
        const grants = await api.queryGrants(
          { limit: PAGE_SIZE, expand: ["principal"] },
          { project_id: project.id },
        );
        return { project: { id: project.id, name: project.name }, grants: grants.grants };
      }),
    );
    return { sections };
  },
  component: AdminsScreen,
});

/**
 * Settings content is a fixed column centred in the main area, narrower than a
 * portal screen: the design measures 704px against the portal's full width.
 * Named as a design token in #1064; until that lands the value lives here
 * rather than being spread across the settings screens as it arrives.
 */
const SETTINGS_COLUMN = "mx-auto w-full max-w-[704px]";

// `RESOURCE_HEADER`'s `px-2` is deliberately not used here: the design puts the
// heading flush with the card's own edge rather than inset from it.

/**
 * One page of projects. `GET /users/me/projects` is cursor-paginated and the
 * Projects screen walks it, but this one does not: a person administers a
 * handful of projects, and a settings pane a hundred sections long is a
 * different design problem. The limit is the API's maximum.
 */
const PROJECTS_LIMIT = 100;

/**
 * One page of grants per project. `POST /grants/query` is cursor-paginated like
 * the other list reads, but this screen does not page yet: a project's
 * administrators are a handful of people, and `Load more` with nothing past the
 * first page is a control that never does anything. Add it with the first
 * project that needs it.
 */
const PAGE_SIZE = 100;

type Grant = Awaited<ReturnType<typeof api.queryGrants>>["grants"][number];

/**
 * A project the person can act on, with the grants held on it. Exported only
 * because it is part of the loader's return type, which the generated route
 * tree names.
 */
export interface ProjectSection {
  project: { id: string; name: string };
  grants: Grant[];
}

interface AdminRow {
  /** Grant id — what `DELETE /grants/{id}` revokes. */
  id: string;
  /** The person or team, as the table labels them. */
  name: string;
  /** The catalog relation this grant carries, title-cased for display. */
  level: string;
}

function AdminsScreen() {
  const { sections } = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className={`${RESOURCE_PAGE} pt-11`}>
      <div className={`${SETTINGS_COLUMN} flex flex-col gap-10`}>
        <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight lg:h-10 lg:leading-10">
          Admins
        </h1>

        {sections.length === 0 ? (
          // Nothing to administer: no claimed project and no grant from anyone.
          // A project comes from the claim page and a grant is somebody else's
          // to give, so there is no action to offer here.
          <div className={`${RESOURCE_TABLE_WRAP} text-muted-foreground py-24 text-center text-xs`}>
            No projects yet.
          </div>
        ) : (
          sections.map((section) => (
            <ProjectAdmins
              key={section.project.id}
              section={section}
              onChanged={() => router.invalidate()}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * One project's admins: its name, the add action and the grant table. Every
 * request made from here carries `section.project.id`, which is what keeps the
 * add and remove dialogs honest about which project they touch.
 */
function ProjectAdmins({ section, onChanged }: { section: ProjectSection; onChanged: () => void }) {
  const { project, grants } = section;
  const headingId = useId();
  const rows = grants.map(toAdminRow);
  // Only `admin`: this screen creates that relation, and `POST /grants` refuses
  // a duplicate per principal *and* relation, so somebody holding `viewer` can
  // still be made an admin.
  const alreadyAdmins = grants
    .filter((grant) => grant.relation === "admin")
    .map((grant) => grant.user?.user_id ?? grant.team?.team_id)
    .filter((id): id is string => Boolean(id));

  return (
    // Labelled by the project name, so each section is a landmark assistive
    // tech can jump to by project.
    <section aria-labelledby={headingId}>
      <div className="flex flex-col gap-4 lg:h-10 lg:flex-row lg:items-center lg:justify-between">
        <h2 id={headingId} className="text-foreground truncate font-serif text-lg leading-6">
          {project.name}
        </h2>
        <AddAdminDialog projectId={project.id} alreadyAdmins={alreadyAdmins} onAdded={onChanged}>
          <Button className="w-full gap-1.5 px-2.5 lg:w-auto">
            <Plus aria-hidden />
            Add admin
          </Button>
        </AddAdminDialog>
      </div>

      <div className={`${RESOURCE_TABLE_WRAP} mt-6`}>
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="border-border border-b hover:bg-transparent">
              <ResourceHeadCell>Email</ResourceHeadCell>
              {/* The design's `Status` column is not here: a grant has no status
                  field, so every row would read `Active` and the column would
                  say nothing about any of them. */}
              <ResourceHeadCell>Level</ResourceHeadCell>
              <TableHead className="h-14 w-[60px] px-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell colSpan={3} className="text-muted-foreground h-24 text-center">
                  No admins yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/40 border-0">
                  <TableCell className={`${RESOURCE_CELL} text-foreground truncate text-sm`}>
                    {row.name}
                  </TableCell>
                  <TableCell className={`${RESOURCE_CELL} text-muted-foreground text-sm`}>
                    {row.level}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <RowActions projectId={project.id} row={row} onRemoved={onChanged} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/**
 * How a grant is labelled.
 *
 * `expand: ["principal"]` copies envelope fields onto the same `user` / `team`
 * ref so the table needs no read per row. A deleted user leaves its grant
 * behind as a degraded ref (`user_id` / `team_id` only). A user's identity
 * fields are themselves optional, since ADR 058 lets a schema designate
 * neither a display nor an identifier. The chain ends at that id, which
 * always exists — and which is what the operator needs to know which grant
 * they are revoking.
 *
 * Discriminate on which of `user` or `team` is present. Label from the
 * team's name or the user's `display` / `identifier`; the id is always
 * the last fallback in `toAdminRow`.
 */
function toAdminRow(grant: Grant): AdminRow {
  return {
    id: grant.id,
    name: principalName(grant) ?? grant.user?.user_id ?? grant.team?.team_id ?? grant.id,
    level: grant.relation.charAt(0).toUpperCase() + grant.relation.slice(1),
  };
}

function principalName(grant: Grant): string | undefined {
  return grant.team?.name ?? grant.user?.display ?? grant.user?.identifier;
}

/**
 * The row menu carries only the revoke.
 *
 * It names the relation the row actually holds. This screen only ever creates
 * `admin`, but the list shows whatever a grant carries, and a row saying
 * "Remove admin" over a `viewer` grant would misdescribe what the click
 * revokes.
 *
 * The design's `Revoke invite` and `Resend invite` belong to an invite flow that
 * does not exist, and changing a grant's relation has no endpoint (#1021):
 * delete and re-create is the documented path. Each returns with the call that
 * makes it real.
 */
function RowActions({
  projectId,
  row,
  onRemoved,
}: {
  projectId: string;
  row: AdminRow;
  onRemoved: () => void;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const action = `Remove ${row.level.toLowerCase()}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`}>
            {/* Horizontal dots, as this frame draws them. The portal tables
                use the vertical glyph; the two surfaces differ in the design. */}
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
            {action}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoveAdminDialog
        projectId={projectId}
        grantId={row.id}
        name={row.name}
        level={row.level}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onRemoved={onRemoved}
      />
    </>
  );
}
