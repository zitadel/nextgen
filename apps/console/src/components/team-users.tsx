import { Link } from "@tanstack/react-router";
import { Box, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AddUserSheet } from "@/components/add-user-sheet";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceRow,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { USER_CLAMP, UserIdCell, UserIdentityCell } from "@/components/user-cells";
import { useLoadMore } from "@/hooks/use-load-more";
import { useRequiredProjectScope } from "@/lib/project-scope";
import {
  fetchTeamUsers,
  type LifecycleOwner,
  type TeamUserRelation,
  type TeamUsersPage,
  toTeamUserRow,
} from "@/lib/team-users";

/**
 * A team's users in one of the two relations ADR 024 keeps apart: the
 * **members** who collaborate in the team, or the users whose lifecycle the
 * team **owns**. Each is its own tab and its own query.
 *
 * The members list carries a Lifecycle owner column, so a member owned by
 * another team — or by nobody but themselves — reads as such here rather than
 * only on that other team's Owned tab. The owned list drops the column: every
 * row's owner is this team.
 *
 * **Add user is the members tab's action only.** `POST /users?team_id=` makes
 * the new user a member, and no endpoint sets a lifecycle owner, so offering it
 * on the owned tab would create a user that does not appear there. For the same
 * reason the owned list is nearly always empty today.
 *
 * Members are `active` memberships only: the `team_id` filter does not match a
 * pending invite, and a full roster waits on a members endpoint. No endpoint
 * adds an existing user or removes a membership yet, so the rows carry no menu.
 */
export function TeamUsers({
  team,
  relation,
  loaded,
  onChanged,
}: {
  team: { id: string; name: string };
  relation: TeamUserRelation;
  /** The loader's first page; a new one resets Load more. */
  loaded: TeamUsersPage;
  /** Called after a user was added, to reload the page's data. */
  onChanged: () => void | Promise<void>;
}) {
  const projectId = useRequiredProjectScope();
  const [ownersExpanded, setOwnersExpanded] = useState(loaded.ownersExpanded);
  useEffect(() => setOwnersExpanded(loaded.ownersExpanded), [loaded]);

  const paging = useLoadMore(
    loaded,
    // A later page refused shows as Load more's error rather than an empty list.
    (pageToken) => fetchTeamUsers(projectId, team.id, relation, pageToken, ownersExpanded),
    "Could not load more users.",
    // A later page can be served without the expansion the first page carried;
    // the column then falls back to ids for the rest.
    (page) => setOwnersExpanded((current) => current && page.ownersExpanded),
  );

  const rows = useMemo(
    () =>
      [...loaded.items, ...paging.extra].map((user, index) => toTeamUserRow(user, index, team.id)),
    [loaded.items, paging.extra, team.id],
  );
  const members = relation === "members";

  return (
    <>
      {members && (
        <div className="mb-4 flex justify-end">
          <AddUserSheet team={team} onCreated={onChanged}>
            {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
                `px-2.5`. */}
            <Button className="shrink-0 gap-1.5 px-2.5!">
              <Plus aria-hidden />
              Add user
            </Button>
          </AddUserSheet>
        </div>
      )}
      <div className={RESOURCE_TABLE_WRAP}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>User</ResourceHeadCell>
              <ResourceHeadCell>Status</ResourceHeadCell>
              {members && <ResourceHeadCell>Lifecycle owner</ResourceHeadCell>}
              <ResourceHeadCell>ID</ResourceHeadCell>
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <ResourceEmptyRow colSpan={members ? 4 : 3}>
                {members ? "No members yet." : "This team owns no users."}
              </ResourceEmptyRow>
            ) : (
              rows.map((user) => (
                <ResourceRow key={user.id} className="group">
                  <UserIdentityCell user={user} />
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={user.status} />
                  </TableCell>
                  {members && (
                    <TableCell className={`${RESOURCE_CELL_MUTED} ${USER_CLAMP}`}>
                      <OwnerCell owner={user.owner} />
                    </TableCell>
                  )}
                  <UserIdCell user={user} />
                </ResourceRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <LoadMore paging={paging} />
    </>
  );
}

/**
 * Who owns the user's lifecycle. Another team links to its page, named when
 * the expansion resolved it and shown by id when the credential could not read
 * it — the id is on every user, so the column never goes blank.
 */
function OwnerCell({ owner }: { owner: LifecycleOwner }) {
  switch (owner.kind) {
    case "self":
      return <>Self-owned</>;
    case "this":
      return <>This team</>;
    case "unknown":
      return <>—</>;
    case "other":
      return (
        <Link
          to="/teams/$teamId"
          params={{ teamId: owner.teamId }}
          className="hover:text-foreground flex items-center gap-1.5 underline-offset-2 hover:underline"
        >
          <Box aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
          <span className="truncate">{owner.name ?? owner.teamId}</span>
        </Link>
      );
  }
}
