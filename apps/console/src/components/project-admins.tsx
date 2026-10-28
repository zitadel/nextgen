import { Plus } from "lucide-react";
import { useState } from "react";

import { AddAdminDialog } from "@/components/add-admin-dialog";
import { CARD_ACTION_BUTTON } from "@/components/detail-page";
import { type Removable, RemoveAdminDialog } from "@/components/remove-admin-dialog";
import {
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  RowMenu,
} from "@/components/resource-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { joinAnd, titleCase } from "@/lib/text";

import type { api } from "@/api/zitadel";

type Admin = Awaited<ReturnType<typeof api.listProjectAdmins>>["admins"][number];
type Source = Admin["sources"][number];
type Grant = Awaited<ReturnType<typeof api.queryGrants>>["grants"][number];

/**
 * A project's admins: who administers it, how each of them holds that access,
 * and how it is given and taken away (#1025, journey in #769). The Admins tab
 * of the project's own page, because a grant is project-level data (#1238):
 * the project id comes from the route, and every request made from here
 * carries it. The Add button is `AddAdminButton`, which the page draws on the
 * tab row.
 *
 * **People come from `GET /projects/{id}/admins`** (#1462). It lists each person
 * once with every way they hold admin access: membership in the owning team,
 * an admin grant to a team they are in, or an admin grant to them directly.
 * So the owner is a row like anyone else, and a person who is both an owning
 * team member and a granted admin is one row with two lines in `Access`.
 *
 * **Every other grant is a row of its own, from the grants read.** The admins
 * list is people with live admin access, so it leaves out a grant to a team the
 * viewer is not in, a `viewer` or `editor` grant, an expired grant and a
 * deleted user's grant. Each is still the project's, and still the thing to
 * revoke, so each is a row: a team's, named by the team, or the person's,
 * degraded to the id where nothing else is left. Only a grant the admins list
 * already shows on a person's row is left out, so nobody appears twice for it.
 *
 * **Only a direct grant is removable from a person's row.** Owning-team access
 * is not a grant, and a team grant belongs to the team's row; so a person who
 * holds access only through a team has no actions, and removing a grant from
 * someone who keeps admin access another way says so, rather than claiming
 * they lose the project.
 *
 * **A viewer with no row is told why.** Whoever opens this page can see the
 * project, but a platform operator (ADR 075) holds it through neither a grant
 * nor the owning team, so no row is theirs and the line says their access is
 * not a grant of their own.
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
 * and the table renders whichever relation a grant carries, but this section
 * only ever creates `admin`: #769 puts other access levels out of scope.
 */
export function ProjectAdmins({
  projectId,
  admins,
  grants,
  viewerUserId,
  onChanged,
}: {
  projectId: string;
  admins: Admin[];
  grants: Grant[];
  /** The signed-in user, to mark their own row. */
  viewerUserId?: string;
  /** Called after a grant was removed, to reload the page's data. */
  onChanged: () => void;
}) {
  const rows = toRows(admins, grants, viewerUserId);
  return (
    // Labelled so the section is a landmark assistive tech can jump to.
    <section aria-label="Admins" className="flex flex-col gap-4">
      <div className={RESOURCE_TABLE_WRAP}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>Name</ResourceHeadCell>
              {/* The design's `Status` column is not here: a grant has no status
                field, so every row would read `Active` and the column would
                say nothing about any of them. `Access` says what the design's
                `Level` did and where it comes from. */}
              <ResourceHeadCell>Access</ResourceHeadCell>
              <ResourceMenuHead className="w-15" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <ResourceEmptyRow colSpan={3}>No admins to show.</ResourceEmptyRow>
            ) : (
              rows.map((row) => (
                <ResourceRow key={row.key}>
                  <TableCell className={`${RESOURCE_CELL} text-foreground text-sm`}>
                    {/* No person/team glyph: the two look alike at 16px, so a team
                        row carries a label instead. */}
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{row.name}</span>
                      {row.kind === "team" && <Badge variant="secondary">Team</Badge>}
                      {row.self && <span className="text-muted-foreground shrink-0">(you)</span>}
                    </span>
                  </TableCell>
                  <TableCell className={RESOURCE_CELL_MUTED}>{row.access}</TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    {row.removable && (
                      <RowActions
                        projectId={projectId}
                        name={row.name}
                        removable={row.removable}
                        onRemoved={onChanged}
                      />
                    )}
                  </TableCell>
                </ResourceRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/**
 * The tab's one action, drawn on the tab row rather than in the table: the
 * secondary small button the design places beside the tabs.
 */
export function AddAdminButton({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  return (
    <AddAdminDialog projectId={projectId} onAdded={onAdded}>
      <Button variant="secondary" size="sm" className={CARD_ACTION_BUTTON}>
        <Plus aria-hidden />
        Add admin
      </Button>
    </AddAdminDialog>
  );
}

interface AdminRow {
  key: string;
  kind: "user" | "team";
  /** The person or team, as the table labels them. */
  name: string;
  /** The signed-in user's own row. */
  self: boolean;
  /** Every way the row holds access, as one line. */
  access: string;
  /** The grant the row's action revokes; absent where there is none. */
  removable?: Removable;
}

/**
 * The rows, sorted by label. The admins list orders by user id, which says
 * nothing to a reader, and the team rows come from another read.
 */
function toRows(admins: Admin[], grants: Grant[], viewerUserId?: string): AdminRow[] {
  const shown = new Set(admins.flatMap((admin) => admin.sources.flatMap(directGrantId)));
  const byUser = new Map(admins.map((admin) => [admin.user.user_id, admin]));
  const rows = [
    ...admins.map((admin) => toPersonRow(admin, viewerUserId)),
    ...grants
      .filter((grant) => !shown.has(grant.id))
      .map((grant) => toGrantRow(grant, byUser, viewerUserId)),
  ];
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The id of a person's own grant; a team's grant is the team's row, not theirs. */
function directGrantId(source: Source): string[] {
  return source.type === "grant" && !source.team ? [source.grant_id] : [];
}

/**
 * A user-ref renders `display`, falling back to `identifier`, then `user_id`
 * (ADR 058 §3): a deleted user degrades to the id, which is what the operator
 * needs to know whose grant they are revoking.
 */
function toPersonRow(admin: Admin, viewerUserId?: string): AdminRow {
  const { user, sources } = admin;
  const direct = sources.find((source) => source.type === "grant" && !source.team);
  return {
    key: `user:${user.user_id}`,
    kind: "user",
    name: user.display ?? user.identifier ?? user.user_id,
    self: user.user_id === viewerUserId,
    access: describeAccess(sources),
    removable:
      direct?.type === "grant"
        ? {
            grantId: direct.grant_id,
            principal: "user",
            keeps: sources.filter((source) => source !== direct).map(describeKept),
          }
        : undefined,
  };
}

/**
 * The `Access` cell: every source on one line, in the API's order (owning
 * team, team grants, the direct grant), so the row keeps the list's height
 * however many there are.
 */
function describeAccess(sources: Source[]): string {
  const [first, ...rest] = sources.map(describeSource);
  return joinAnd([
    first ?? "",
    ...rest.map((line) => line.charAt(0).toLowerCase() + line.slice(1)),
  ]);
}

function describeSource(source: Source): string {
  if (source.type === "owning_team") {
    return "Owning team";
  }
  return source.team ? `Via team ${teamLabel(source.team)}` : "Admin grant";
}

/** The same source as the remove dialog names what stays. */
function describeKept(source: Source): string {
  if (source.type === "owning_team") {
    return "the owning team";
  }
  return source.team ? `team ${teamLabel(source.team)}` : "an admin grant of their own";
}

/** A team's name is on the ref only where the viewer may see it; the id always is. */
function teamLabel(team: { team_id: string; name?: string }): string {
  return team.name ?? team.team_id;
}

/**
 * A grant's `user` / `team` ref carries the name without a read per row.
 * Discriminate on which of the two is present; the id is always the last
 * fallback. A person's lower grant keeps whatever the admins list says they
 * hold, so removing it does not claim they lose the project.
 */
function toGrantRow(grant: Grant, byUser: Map<string, Admin>, viewerUserId?: string): AdminRow {
  const level = grant.relation;
  const principal = grant.team ? "team" : "user";
  const admin = grant.user && byUser.get(grant.user.user_id);
  return {
    key: `grant:${grant.id}`,
    kind: principal,
    name: grant.team
      ? teamLabel(grant.team)
      : (grant.user?.display ?? grant.user?.identifier ?? grant.user?.user_id ?? grant.id),
    self: grant.user?.user_id === viewerUserId,
    access: `${titleCase(level)} grant`,
    removable: {
      grantId: grant.id,
      principal,
      keeps: admin ? admin.sources.map(describeKept) : [],
      unresolved: principal === "user" && !grant.user?.display && !grant.user?.identifier,
    },
  };
}

/**
 * The row menu carries only the revoke. It says "grant" whatever relation the
 * grant holds: the row's `Access` cell already names it.
 *
 * The design's `Revoke invite` and `Resend invite` belong to an invite flow that
 * does not exist, and changing a grant's relation has no endpoint (#1021):
 * delete and re-create is the documented path. Each returns with the call that
 * makes it real.
 */
function RowActions({
  projectId,
  name,
  removable,
  onRemoved,
}: {
  projectId: string;
  name: string;
  removable: Removable;
  onRemoved: () => void;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <>
      <RowMenu name={name} contentClassName="w-auto">
        <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
          Remove grant
        </DropdownMenuItem>
      </RowMenu>

      <RemoveAdminDialog
        projectId={projectId}
        removable={removable}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onRemoved={onRemoved}
      />
    </>
  );
}
