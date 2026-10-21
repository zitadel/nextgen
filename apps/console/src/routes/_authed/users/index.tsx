import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Box, MoreVertical, Plus, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AddUserSheet } from "@/components/add-user-sheet";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourcePage,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/lib/project-scope";
import type { SchemaField } from "@/lib/schema";
import type { UserTeam } from "@/lib/user";
import { columnsForUsers, fetchUsers, toUserRow } from "@/lib/user-list";

export const Route = createFileRoute("/_authed/users/")({
  // `User`, not `Users`: the single-person glyph. The plural two-person one
  // reads as a group.
  // Order 3: Teams sits at 2.
  staticData: { scope: "project", nav: { label: "Users", order: 3, icon: User } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const page = await fetchUsers(projectId);
    return {
      users: page.users,
      teamsExpanded: page.teamsExpanded,
      nextPageToken: page.next_page_token ?? undefined,
      columns: await columnsForUsers(projectId, page.users),
    };
  },
  component: UsersScreen,
});

/** One fetched page, with the list state it carries besides its rows. */
interface UsersPage {
  items: Record<string, unknown>[];
  nextPageToken?: string;
  columns: SchemaField[];
  teamsExpanded: boolean;
}

/** The User and schema-driven cells clamp at 280px and truncate. */
const CLAMP = "max-w-70";

function UsersScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const router = useRouter();

  const [columns, setColumns] = useState(loaded.columns);
  const [teamsExpanded, setTeamsExpanded] = useState(loaded.teamsExpanded);
  useEffect(() => {
    setColumns(loaded.columns);
    setTeamsExpanded(loaded.teamsExpanded);
  }, [loaded]);

  const paging = useLoadMore(
    loaded,
    async (pageToken): Promise<UsersPage> => {
      const page = await fetchUsers(projectId, pageToken, teamsExpanded);
      return {
        items: page.users,
        nextPageToken: page.next_page_token ?? undefined,
        // A later page can carry a schema the first page never referenced, which
        // would otherwise render its users with every cell blank.
        columns: await columnsForUsers(projectId, [...users, ...page.users]),
        teamsExpanded: page.teamsExpanded,
      };
    },
    "Could not load more users.",
    (page) => {
      setColumns(page.columns);
      // A later page can be served without the expansion the first page carried
      // — a permission revoked mid-list — and a Team column standing over blank
      // cells would read as "these users are on no team".
      setTeamsExpanded((current) => current && page.teamsExpanded);
    },
  );

  const users = useMemo(() => [...loaded.users, ...paging.extra], [loaded.users, paging.extra]);

  const rows = useMemo(
    () => users.map((user, index) => toUserRow(user, index, columns)),
    [users, columns],
  );

  return (
    <ResourcePage>
      {/* No search beside the title: it is out of the page headers until there
          is a console-wide solution (D19). */}
      <ResourceTitle
        action={
          <AddUserSheet onCreated={() => router.invalidate()}>
            {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
                `px-2.5`, which renders the 68px control at 72px. */}
            <Button className="shrink-0 gap-1.5 px-2.5!">
              <Plus aria-hidden />
              Add
            </Button>
          </AddUserSheet>
        }
      >
        Users
      </ResourceTitle>

      {/* The column set is schema-driven and so has no fixed width; the design
          scrolls the table horizontally rather than compressing cells. */}
      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>User</ResourceHeadCell>
              <ResourceHeadCell>Identifier</ResourceHeadCell>
              {columns.map((column) => (
                <ResourceHeadCell key={column.key}>{column.label}</ResourceHeadCell>
              ))}
              <ResourceHeadCell>Status</ResourceHeadCell>
              {/* After `Status`, where the design's column order puts it. */}
              {teamsExpanded && <ResourceHeadCell>Team</ResourceHeadCell>}
              <ResourceHeadCell>ID</ResourceHeadCell>
              <ResourceMenuHead className="w-15" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <ResourceEmptyRow colSpan={columns.length + (teamsExpanded ? 6 : 5)}>
                No users yet.
              </ResourceEmptyRow>
            ) : (
              rows.map((user) => (
                <ResourceRow key={user.id}>
                  {/* The User column renders the server-resolved identity
                      (display → identifier → id, ADR 058 §3a) and carries the
                      link to the detail screen — schema-driven columns cannot
                      promise a meaningful leading value, this cell always can. */}
                  <TableCell className={`${RESOURCE_CELL} ${CLAMP} text-sm`}>
                    <Link
                      to="/users/$userId"
                      params={{ userId: user.id }}
                      className="text-foreground block truncate font-medium underline-offset-2 hover:underline"
                    >
                      {user.name}
                    </Link>
                  </TableCell>
                  {/* The designated identifier (x-identifier) — role-named, so a
                      mixed-schema list reads down one column whether a row's
                      identifier is an email or a loginname; the tooltip names
                      the property it came from. */}
                  <TableCell
                    className={`${RESOURCE_CELL_MUTED} ${CLAMP}`}
                    title={user.identifierProperty}
                  >
                    {user.identifier ?? "—"}
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.key} className={`${RESOURCE_CELL_MUTED} ${CLAMP}`}>
                      {user.values[column.key] ?? "—"}
                    </TableCell>
                  ))}
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={user.status} />
                  </TableCell>
                  {teamsExpanded && (
                    <TableCell className={`${RESOURCE_CELL_MUTED} ${CLAMP}`}>
                      <TeamCell teams={user.teams} truncated={user.teamsTruncated} />
                    </TableCell>
                  )}
                  <TableCell className={`${RESOURCE_CELL} text-foreground truncate text-sm`}>
                    {user.id}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <RowActions
                      userId={user.id}
                      name={user.name}
                      onDeleted={() => router.invalidate()}
                    />
                  </TableCell>
                </ResourceRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {/* Full width and `secondary`, 24px under the table, not a centred pill. */}
      <LoadMore paging={paging} />
    </ResourcePage>
  );
}

/**
 * The teams a user belongs to, glyphed the way the design draws the cell and the
 * way the Teams directory draws a team row.
 *
 * Each name opens its team, as the Teams directory's own rows do — the embedded
 * entry carries the id, so the link costs no extra read.
 *
 * `+more` is deliberately not a link. The response carries the capped list and a
 * boolean, not the names past the cap, so there is nothing to expand inline
 * without the per-row roster read that `expand` exists to avoid; and the user
 * detail screen does not render teams yet (decisions log D3), so there is no
 * screen to send the operator to. It becomes a link to that screen when the
 * screen lists them.
 */
function TeamCell({ teams, truncated }: { teams: UserTeam[]; truncated: boolean }) {
  if (teams.length === 0) return <>—</>;
  return (
    <span className="flex items-center gap-1.5">
      <Box aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
      {/* The names truncate; the marker does not. Inside the truncating span it
          is the first thing CSS clips — and a roster long enough to overflow is
          exactly the one that has more teams to report. */}
      <span className="truncate">
        {teams.map((team, index) => (
          <span key={team.id}>
            {/* The separator sits outside the anchor: it belongs to the list,
                not to either team it divides. */}
            {index > 0 && ", "}
            <Link
              to="/teams/$teamId"
              params={{ teamId: team.id }}
              className="hover:text-foreground underline-offset-2 hover:underline"
            >
              {team.name}
            </Link>
          </span>
        ))}
      </span>
      {truncated && <span className="shrink-0">+more</span>}
    </span>
  );
}

/**
 * The row menu carries only actions that reach the API.
 *
 * The design's fuller menu is not buildable yet:
 *
 *   - `Edit user` — no `PATCH`/`PUT /users/{user_id}` endpoint (#693)
 *   - `Deactivate` — no `status` field and no lifecycle endpoint (#553)
 *   - `Reset password` — `PUT /users/{user_id}/password` exists, but the screen
 *     that would collect the new password does not
 *
 * They are left out rather than disabled so the menu is a list of things that
 * work. Add each one back with the change that makes it real.
 */
function RowActions({
  userId,
  name,
  onDeleted,
}: {
  userId: string;
  name: string;
  onDeleted: () => void | Promise<void>;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <RowMenu name={name} icon={MoreVertical}>
        <DropdownMenuItem asChild>
          <Link to="/users/$userId" params={{ userId }}>
            View details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
          Delete
        </DropdownMenuItem>
      </RowMenu>
      {/* Outside the menu, and opened by state rather than a trigger, so the
          menu closes on select. Nested inside, the still-open menu keeps the
          rest of the page `aria-hidden` after the dialog is dismissed. */}
      <DeleteUserDialog
        userId={userId}
        name={name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}
