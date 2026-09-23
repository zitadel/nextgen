import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";

import { AddAdminDialog } from "@/components/add-admin-dialog";
import { EYEBROW } from "@/components/detail-meta";
import { RemoveAdminDialog } from "@/components/remove-admin-dialog";
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

export type Grant = Awaited<ReturnType<typeof api.queryGrants>>["grants"][number];

/**
 * A project's admins: who administers it, and how that access is given and
 * taken away (#1025, journey in #769). Rendered on the project's own page,
 * because a grant is project-level data (#1238): the project id comes from the
 * route, and every request made from here carries it.
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
 * and the table renders whichever relation a grant carries, but this section
 * only ever creates `admin`: #769 puts other access levels out of scope.
 */
export function ProjectAdmins({
  projectId,
  grants,
  onChanged,
}: {
  projectId: string;
  grants: Grant[];
  /** Called after a grant was added or removed, to reload the page's data. */
  onChanged: () => void;
}) {
  const rows = grants.map(toAdminRow);
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
  /** Grant id — what `DELETE /grants/{id}` revokes. */
  id: string;
  /** The person or team, as the table labels them. */
  name: string;
  /** The catalog relation this grant carries, title-cased for display. */
  level: string;
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
 * the last fallback.
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
 * It names the relation the row actually holds. This section only ever creates
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
