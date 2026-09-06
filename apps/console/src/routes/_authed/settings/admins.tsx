import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Ellipsis, Plus, UserRound } from "lucide-react";
import { useState } from "react";

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
import { field } from "../../../lib/record";
import { getConsoleProjectId } from "../../../runtime/runtime";

/**
 * Settings → Admins: who administers this project, and how that access is
 * given and taken away (#1025, journey in #769).
 *
 * **Not an invite flow.** The design draws `Invite`, a `Pending` status and
 * revoke/resend actions, but a grant is only ever created against a person who
 * already exists: `POST /grants` takes a `principal_id`, and the grant resource
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
    const page = await api.queryGrants(
      { limit: PAGE_SIZE, expand: ["principal"] },
      { project_id: getConsoleProjectId() },
    );
    return { grants: page.grants };
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
 * One page of grants. `POST /grants/query` is cursor-paginated like the other
 * list reads, but this screen does not page yet: a project's administrators are
 * a handful of people, and `Load more` with nothing past the first page is a
 * control that never does anything. Add it with the first project that needs it.
 */
const PAGE_SIZE = 100;

type Grant = Awaited<ReturnType<typeof api.queryGrants>>["grants"][number];

interface AdminRow {
  /** Grant id — what `DELETE /grants/{id}` revokes. */
  id: string;
  /** The person or team, as the table labels them. */
  name: string;
  /** The catalog relation this grant carries, title-cased for display. */
  level: string;
}

function AdminsScreen() {
  const { grants } = Route.useLoaderData();
  const router = useRouter();
  const rows = grants.map(toAdminRow);
  // Only `admin`: this screen creates that relation, and `POST /grants` refuses
  // a duplicate per principal *and* relation, so somebody holding `viewer` can
  // still be made an admin.
  const alreadyAdmins = grants
    .filter((grant) => grant.relation === "admin")
    .map((grant) => grant.principal_id);

  return (
    <div className={`${RESOURCE_PAGE} pt-11`}>
      <div className={SETTINGS_COLUMN}>
      <div className="flex flex-col gap-4 lg:h-10 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">Admins</h1>
        <AddAdminDialog alreadyAdmins={alreadyAdmins} onAdded={() => router.invalidate()}>
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
                    <RowActions row={row} onRemoved={() => router.invalidate()} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      </div>
    </div>
  );
}

/**
 * How a grant is labelled.
 *
 * `expand: ["principal"]` embeds the principal so the table needs no read per
 * row. Every fallback below is real: the property is absent when the expansion
 * was refused, `null` when the principal cannot be loaded (a deleted user
 * leaves its grant behind), and a user's identity fields are themselves
 * optional, since ADR 058 lets a schema designate neither a display nor an
 * identifier. The chain ends at the id, which always exists — and which is what
 * the operator needs to know which grant they are revoking.
 *
 * The embedded body is a user or a team, discriminated by `principal_type` as
 * the contract says. They are separate union members and the type ties neither
 * to that field, so the values are read the way the console reads every other
 * open record: defensively, by name.
 */
function toAdminRow(grant: Grant): AdminRow {
  return {
    id: grant.id,
    name: principalName(grant) ?? grant.principal_id,
    level: grant.relation.charAt(0).toUpperCase() + grant.relation.slice(1),
  };
}

function principalName(grant: Grant): string | undefined {
  if (!grant.principal) return undefined;
  const principal = grant.principal as unknown as Record<string, unknown>;
  if (grant.principal_type === "team") return field(principal, "name");
  return field(principal, "display") ?? field(principal, "identifier");
}

/**
 * The row menu carries only `Remove admin`.
 *
 * The design's `Revoke invite` and `Resend invite` belong to an invite flow that
 * does not exist, and changing a grant's relation has no endpoint (#1021) —
 * delete and re-create is the documented path. Each returns with the call that
 * makes it real.
 */
function RowActions({ row, onRemoved }: { row: AdminRow; onRemoved: () => void }) {
  const [removeOpen, setRemoveOpen] = useState(false);

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
            Remove admin
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RemoveAdminDialog
        grantId={row.id}
        name={row.name}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onRemoved={onRemoved}
      />
    </>
  );
}
