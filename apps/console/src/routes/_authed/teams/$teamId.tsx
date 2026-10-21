import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ApiError } from "@zitadel/api/runtime/fetch";
import { Box } from "lucide-react";
import { useMemo } from "react";

import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { RenameCard } from "@/components/rename-card";
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
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/lib/project-scope";
import { fetchTeamMembers, toUserRow } from "@/lib/user-list";

/**
 * Team detail: a resource inside Teams, not a scope of its own. The sidebar
 * keeps the project's nav with Teams marked, and the team's sections are tabs,
 * as on user detail. A team becomes a sidebar scope once it owns configuration
 * (Console ADR 0005).
 *
 * The header card carries `TEAM ID` and `CREATED`. The design draws a third cell,
 * `PRIMARY DOMAIN`, which is deliberately not built: a domain that discovers and
 * claims a team is security-relevant, so it needs its own model — verification,
 * and more than one domain per team — rather than a string on `team-response`.
 * That model is not defined yet, so the cell is left out rather than shown empty.
 */
export const Route = createFileRoute("/_authed/teams/$teamId")({
  staticData: { scope: "project" },
  loaderDeps: projectScopeDeps,
  loader: async ({ params, deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [team, members] = await Promise.all([
      api.getTeam(params.teamId),
      fetchMembers(projectId, params.teamId),
    ]);
    return { team, members };
  },
  component: TeamDetail,
});

interface MembersPage {
  items: Record<string, unknown>[];
  nextPageToken?: string;
}

/**
 * One page of members, or `null` when the read is refused: listing them needs
 * `team_membership.read`, which a grant on only part of the project does not
 * carry, and that costs the Members tab its list, not the team its page.
 */
async function fetchMembers(
  projectId: string,
  teamId: string,
  pageToken?: string,
): Promise<MembersPage | null> {
  try {
    const page = await fetchTeamMembers(projectId, teamId, pageToken);
    return { items: page.users, nextPageToken: page.next_page_token ?? undefined };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 403) return null;
    throw cause;
  }
}

function TeamDetail() {
  const { team, members } = Route.useLoaderData();
  const router = useRouter();

  return (
    <Page>
      <DetailHeader
        icon={Box}
        title={team.name}
        status={<StatusBadge status={team.status} />}
        meta={
          <>
            <MetaValue label="Team ID" value={team.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(team.created_at)} />
          </>
        }
      />

      <Tabs defaultValue="overview" className={`${DETAIL_BODY} gap-6`}>
        <TabsList aria-label="Team detail sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {/* `Tenant name` is the design's label for the team's own `name`, the only
              field `PATCH /teams/{team_id}` accepts. Relabelling it `Team name`
              waits on the decisions log's open naming question. */}
          <RenameCard
            id="team-tenant-name"
            label="Tenant name"
            value={team.name}
            onSave={async (name) => {
              await api.updateTeam(team.id, { name });
              await router.invalidate();
            }}
            errorFallback="Could not save the team."
          />
        </TabsContent>

        <TabsContent value="members">
          {members ? (
            <Members teamId={team.id} loaded={members} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Your access does not include this team&apos;s members.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

/**
 * The team's active members, by the identity the Users list leads with
 * (display → identifier → id, ADR 058), each opening their user. Read-only:
 * no endpoint adds or removes a membership yet.
 */
function Members({ teamId, loaded }: { teamId: string; loaded: MembersPage }) {
  const projectId = useRequiredProjectScope();
  const paging = useLoadMore(
    loaded,
    async (pageToken) => (await fetchMembers(projectId, teamId, pageToken)) ?? { items: [] },
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
                <ResourceRow key={user.id}>
                  <TableCell className={`${RESOURCE_CELL} max-w-70 text-sm`}>
                    <Link
                      to="/users/$userId"
                      params={{ userId: user.id }}
                      className="text-foreground block truncate font-medium underline-offset-2 hover:underline"
                    >
                      {user.name}
                    </Link>
                    {user.secondary && (
                      <span
                        className="text-muted-foreground block truncate text-xs"
                        title={user.identifierProperty}
                      >
                        {user.secondary}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={user.status} />
                  </TableCell>
                  {/* As on Users: the id takes the width left over and truncates. */}
                  <TableCell
                    className={`${RESOURCE_CELL} text-foreground w-full max-w-0 min-w-40 truncate text-sm`}
                    title={user.id}
                  >
                    {user.id}
                  </TableCell>
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
