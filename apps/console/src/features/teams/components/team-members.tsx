import { useMemo } from "react";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceRow,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { UserIdCell, UserIdentityCell } from "@/features/users/components/user-cells";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { useRequiredProjectScope } from "@/features/projects/project-scope";
import { fetchTeamMembers } from "@/features/users/api";
import { toUserRow } from "@/features/users/list";

interface MembersPage {
  items: Record<string, unknown>[];
  nextPageToken?: string;
}

/** One page of members. */
export async function fetchMembers(
  projectId: string,
  teamId: string,
  pageToken?: string,
): Promise<MembersPage> {
  const page = await fetchTeamMembers(projectId, teamId, pageToken);
  return { items: page.users, nextPageToken: page.next_page_token ?? undefined };
}

/**
 * The team's active members, by the identity the Users list leads with
 * (display → identifier → id, ADR 058), each opening their user. Read-only:
 * no endpoint adds or removes a membership yet.
 */
export function Members({ teamId, loaded }: { teamId: string; loaded: MembersPage }) {
  const projectId = useRequiredProjectScope();
  const paging = useLoadMore(
    loaded,
    // A later page refused shows as Load more's error rather than an empty list.
    (pageToken) => fetchMembers(projectId, teamId, pageToken),
    "Could not load more members.",
  );
  const rows = useMemo(
    () => [...loaded.items, ...paging.extra].map((user, index) => toUserRow(user, index, [])),
    [loaded.items, paging.extra],
  );

  return (
    <>
      <div className={RESOURCE_TABLE_WRAP}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>User</ResourceHeadCell>
              <ResourceHeadCell>Status</ResourceHeadCell>
              <ResourceHeadCell>ID</ResourceHeadCell>
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <ResourceEmptyRow colSpan={3}>No members yet.</ResourceEmptyRow>
            ) : (
              rows.map((user) => (
                <ResourceRow key={user.id} className="group">
                  <UserIdentityCell user={user} />
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={user.status} />
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
