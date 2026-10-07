import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";

import { AddAdminDialog } from "@/components/add-admin-dialog";
import { EYEBROW } from "@/components/detail-meta";
import { RemoveAdminDialog, removeGrantAction } from "@/components/remove-admin-dialog";
import { RESOURCE_CELL, ResourceHeadCell } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { api } from "../api/zitadel";

type Admin = Awaited<ReturnType<typeof api.listProjectAdmins>>["admins"][number];
type AdminSource = Admin["sources"][number];

/**
 * A project's admins: who administers it, how each of them holds that access,
 * and how a grant is given and taken away (#1025, journey in #769). Rendered on
 * the project's own page, because a grant is project-level data (#1238): the
 * project id comes from the route, and every request made from here carries it.
 *
 * **A row is a person, not a grant** (#1462). `GET /projects/{id}/admins` lists
 * everyone who can administer the project once, with one source per way they
 * hold it: membership of the owning team, an admin grant to them, or an admin
 * grant to a team they belong to. So the owner who claimed the project is a
 * row, a person with two sources is still one row, and viewer and editor
 * grants are not here at all: they do not make anyone an admin.
 *
 * **Only grants can be revoked here.** Owning-team access ends when the person
 * leaves the team or the project changes owner, and the grants API cannot touch
 * it, so it carries no control. Each grant source gets its own menu item, and
 * the confirmation names what the person keeps (`RemoveAdminDialog`).
 *
 * **Not an invite flow.** The design draws `Invite`, a `Pending` status and
 * revoke/resend actions, but a grant is only ever created against a person who
 * already exists: `POST /grants` takes a user locator, and the grant resource
 * carries no status field, so there is no pending state to render and nothing
 * to revoke before signup. #769 says the same in its scope: the colleague signs
 * up through a separately shared link, and access is given afterwards. The
 * button therefore adds an existing person rather than inviting a new one.
 */
export function ProjectAdmins({
  projectId,
  admins,
  onChanged,
}: {
  projectId: string;
  admins: Admin[];
  /** Called after a grant was added or removed, to reload the page's data. */
  onChanged: () => void;
}) {
  const rows = admins.map(toAdminRow);
  return (
    // Labelled so the section is a landmark assistive tech can jump to.
    <Card className="mt-8 gap-0 rounded-xl py-0" role="region" aria-labelledby="project-admins">
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <span id="project-admins" className={EYEBROW}>
            Admins
          </span>
          <AddAdminDialog projectId={projectId} onAdded={onChanged}>
            {/* Primary and the list screens' size: it is the section's one
                action, and it reads like the Add on Users and Teams. */}
            <Button className="shrink-0 gap-1.5 px-2.5!">
              <Plus aria-hidden />
              Add admin
            </Button>
          </AddAdminDialog>
        </div>
        <Separator />
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="border-border border-b hover:bg-transparent">
              <ResourceHeadCell>Email</ResourceHeadCell>
              {/* The design's `Status` column is not here: a grant has no status
                  field, so every row would read `Active` and the column would
                  say nothing about any of them. */}
              <ResourceHeadCell>Access</ResourceHeadCell>
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
                    {row.access}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    {/* Owning-team access alone has nothing to revoke: the cell
                        stays, empty, so the other columns keep their grid. */}
                    <RowActions projectId={projectId} row={row} onRemoved={onChanged} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface AdminRow {
  /** User id: one row per person. */
  id: string;
  /** The person, as the table labels them. */
  name: string;
  /** Every way they hold admin access, as the table labels it. */
  access: string;
  /** Every way they hold admin access, owning team first, as the API orders them. */
  sources: AccessSource[];
}

interface AccessSource {
  /** What `DELETE /grants/{id}` revokes; absent for owning-team access. */
  grantId?: string;
  /** The team the access comes through; absent for a grant to the person. */
  team?: string;
  /** Phrased to finish "keeps admin access ...", for the revoke dialog. */
  through: string;
}

/**
 * How a person is labelled, and how their access is.
 *
 * The person is a user-ref: `display`, then `identifier`, then `user_id`. A
 * ref arrives bare (`user_id` only) when the caller cannot see the person, or
 * when the schema designates neither a display nor an identifier (ADR 058). The
 * id always exists, and is what the operator needs to tell people apart.
 */
function toAdminRow(admin: Admin): AdminRow {
  return {
    id: admin.user.user_id,
    name: admin.user.display ?? admin.user.identifier ?? admin.user.user_id,
    access: admin.sources.map(sourceLabel).join(", "),
    sources: admin.sources.map((source) => ({
      grantId: source.type === "grant" ? source.grant_id : undefined,
      team: source.team && teamName(source.team),
      through: sourceThrough(source),
    })),
  };
}

/** A grant with a team is to that team; without one, it is to the person. */
function sourceLabel(source: AdminSource): string {
  if (source.type === "owning_team") return "Via owning Team";
  return source.team ? `Via Team ${teamName(source.team)}` : "Direct grant";
}

function sourceThrough(source: AdminSource): string {
  if (source.type === "owning_team") return "through the owning Team";
  return source.team ? `through Team ${teamName(source.team)}` : "through a direct grant";
}

/** A team that can no longer be loaded degrades to its id. */
function teamName(team: NonNullable<AdminSource["team"]>): string {
  return team.name ?? team.team_id;
}

/**
 * The row menu carries one revoke per grant the person holds admin through.
 *
 * Each item names the grant it revokes, not the person: revoking one source
 * leaves the others in place, and a team grant is revoked for every member of
 * the team. A row without a grant renders no menu at all.
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
  // Held past closing, so the dialog keeps its copy while it animates out.
  const [selected, setSelected] = useState<AccessSource | undefined>(undefined);
  const grants = row.sources.filter((source) => source.grantId !== undefined);
  if (grants.length === 0) return null;

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
          {grants.map((source) => (
            <DropdownMenuItem
              key={source.grantId}
              variant="destructive"
              onSelect={() => {
                setSelected(source);
                setRemoveOpen(true);
              }}
            >
              {removeGrantAction(source.team)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selected?.grantId && (
        <RemoveAdminDialog
          projectId={projectId}
          grantId={selected.grantId}
          name={row.name}
          team={selected.team}
          keeps={row.sources
            .filter((source) => source.grantId !== selected.grantId)
            .map((source) => source.through)}
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          onRemoved={onRemoved}
        />
      )}
    </>
  );
}
