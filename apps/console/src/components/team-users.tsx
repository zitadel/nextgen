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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const RELATIONS: { value: TeamUserRelation; label: string; denied: string; empty: string }[] = [
  {
    value: "members",
    label: "Members",
    denied: "Your access does not include this team's members.",
    empty: "No members yet.",
  },
  {
    value: "owned",
    label: "Owned",
    denied: "Your access does not include the users this team owns.",
    empty: "This team owns no users.",
  },
];

/**
 * A team's users, filtered by one of the two relations ADR 024 keeps apart:
 * the **members** who collaborate in the team, or the users whose lifecycle
 * the team **owns**. The filter picks the query; it does not narrow one list,
 * and each relation pages on its own.
 *
 * Both views carry the Lifecycle owner column, so a member owned by another
 * team — or by nobody but themselves — reads as such, and the columns stay put
 * when the filter changes. On the owned view every row reads `This team`.
 *
 * **Add user always makes a member.** `POST /users?team_id=` creates a
 * membership and no endpoint sets a lifecycle owner, so a user added while the
 * owned view is showing switches the filter to members, where they appear. For
 * the same reason the owned view is nearly always empty today.
 *
 * Members are `active` memberships only: the `team_id` filter does not match a
 * pending invite, and a full roster waits on a members endpoint. No endpoint
 * adds an existing user or removes a membership yet, so the rows carry no menu.
 */
export function TeamUsers({
  team,
  members,
  owned,
  onChanged,
}: {
  team: { id: string; name: string };
  /** The loader's first page of each relation, `null` when it was refused. */
  members: TeamUsersPage | null;
  owned: TeamUsersPage | null;
  /** Called after a user was added, to reload the page's data. */
  onChanged: () => void | Promise<void>;
}) {
  const [relation, setRelation] = useState<TeamUserRelation>("members");
  const pages = { members, owned };

  return (
    // The filter switches the table under it, so the table is the filter's
    // panel, as on the Teams list's status tabs. `gap-4` is the 16px from the
    // toolbar to the table.
    <Tabs
      value={relation}
      onValueChange={(value) => setRelation(value as TeamUserRelation)}
      className="gap-4"
    >
      {/* The toolbar: the filter, and the table's own controls beside it, on
          the left; the action on the right. */}
      <div className="flex items-center justify-between gap-3">
        <TabsList aria-label="Filter the team's users">
          {RELATIONS.map(({ value, label }) => (
            // `muted`: a filter inside the page's own tabs, drawn apart from them.
            <TabsTrigger key={value} value={value} variant="muted">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <AddUserSheet
          team={team}
          onCreated={async () => {
            setRelation("members");
            await onChanged();
          }}
        >
          {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
              `px-2.5`. */}
          <Button className="shrink-0 gap-1.5 px-2.5!">
            <Plus aria-hidden />
            Add user
          </Button>
        </AddUserSheet>
      </div>

      {RELATIONS.map(({ value, denied, empty }) => {
        const page = pages[value];
        return (
          // Mounted while hidden: switching away and back keeps the rows Load
          // more fetched and its cursor, as each relation pages on its own.
          <TabsContent key={value} value={value} forceMount hidden={value !== relation}>
            {page ? (
              <UsersTable team={team} relation={value} loaded={page} empty={empty} />
            ) : (
              <p className="text-sm text-muted-foreground">{denied}</p>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

/** One relation's users, paged with Load more. */
function UsersTable({
  team,
  relation,
  loaded,
  empty,
}: {
  team: { id: string; name: string };
  relation: TeamUserRelation;
  /** The loader's first page; a new one resets Load more. */
  loaded: TeamUsersPage;
  empty: string;
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

  return (
    <>
      <div className={RESOURCE_TABLE_WRAP}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>User</ResourceHeadCell>
              <ResourceHeadCell>Status</ResourceHeadCell>
              <ResourceHeadCell>Lifecycle owner</ResourceHeadCell>
              <ResourceHeadCell>ID</ResourceHeadCell>
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <ResourceEmptyRow colSpan={4}>{empty}</ResourceEmptyRow>
            ) : (
              rows.map((user) => (
                <ResourceRow key={user.id} className="group">
                  <UserIdentityCell user={user} />
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={user.status} />
                  </TableCell>
                  <TableCell className={`${RESOURCE_CELL_MUTED} ${USER_CLAMP}`}>
                    <OwnerCell owner={user.owner} />
                  </TableCell>
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
