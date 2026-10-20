import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Box, Plus } from "lucide-react";

import { api } from "@/api/zitadel";
import { AddTeamSheet } from "@/components/add-team-sheet";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_HEADER,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_WRAP,
  RESOURCE_TITLE,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourcePage,
  ResourceRow,
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import { requireProjectScope, useRequiredProjectScope } from "@/lib/project-scope";

/**
 * The two states `team-status` defines. The tabs filter on exactly these, so the
 * screen never shows a state the API does not have — the design's table draws
 * the second one as `Inactive`, but its own tab already writes `Deactivated`.
 */
const STATUSES = ["active", "deactivated"] as const;
type TeamStatus = (typeof STATUSES)[number];

type TeamsSearch = { status: TeamStatus };

export const Route = createFileRoute("/_authed/teams/")({
  staticData: { scope: "project", nav: { label: "Teams", order: 2, icon: Box } },
  // The tab lives in the URL: it is a server-side filter, so it belongs to the
  // request the loader makes rather than to component state. A filtered list
  // is then linkable, survives a reload, and moves with the back button — and
  // changing it re-runs the loader, which resets the paged-in rows the way a
  // create or a delete does.
  validateSearch: (search: Record<string, unknown>): TeamsSearch => ({
    status: STATUSES.find((status) => status === search.status) ?? "active",
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const page = await api.queryTeams(
      { limit: PAGE_SIZE, filter: teamFilter(deps) },
      { project_id: requireProjectScope(deps.project) },
    );
    return { teams: page.teams, nextPageToken: page.next_page_token ?? undefined };
  },
  component: TeamsScreen,
});

/**
 * One page of teams. `POST /teams/query` is cursor-paginated, so this is a page
 * size rather than a cap on what the operator can reach — `Load more` walks the
 * rest (design decisions log D5: a button, not pagination controls).
 */
const PAGE_SIZE = 25;

/**
 * The design lays this table on a fixed 248px grid, so a long team name
 * truncates rather than pushing `Status` and `Created` out of place. The fourth
 * column is the one the design reserves for the row menu, and keeps the three
 * data columns where the design puts them.
 */
const COLUMN = "w-62";

type TeamFilter = NonNullable<Parameters<typeof api.queryTeams>[0]["filter"]>;

/** The filter both the loader and `Load more` send. */
function teamFilter({ status }: TeamsSearch): TeamFilter {
  return [{ field: "status", operation: "equals", value: status }];
}

function TeamsScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();

  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      const page = await api.queryTeams(
        // The same filter the token was issued under: a page token answers one
        // question, and asking a different one with it is not a narrower list
        // but a meaningless one.
        { limit: PAGE_SIZE, page_token: pageToken, filter: teamFilter(search) },
        { project_id: projectId },
      );
      return { items: page.teams, nextPageToken: page.next_page_token ?? undefined };
    },
    "Could not load more teams.",
  );
  const teams = [...loaded.teams, ...paging.extra];

  return (
    <ResourcePage>
      {/* The tabs filter one list rather than switch between panels, so the
          table is the tab's panel: it renders under whichever tab is selected,
          which is also what keeps each trigger's `aria-controls` pointing at a
          region that exists. `gap-4` is the design's 16px from the tabs to the
          table. */}
      <Tabs
        value={search.status}
        onValueChange={(status) =>
          void navigate({ search: (prev) => ({ ...prev, status: status as TeamStatus }) })
        }
        className="gap-4"
      >
        {/* 8px from the title row to the tabs on desktop, 24px on mobile, where
            the design gives the stacked header more room. */}
        <div className={`${RESOURCE_HEADER} flex flex-col gap-6 lg:gap-2`}>
          {/* The title row: the Add button beside the title at every width
              (D19); no search until there is a console-wide one. */}
          <div className="flex min-h-6 items-center justify-between gap-3">
            <h1 className={RESOURCE_TITLE}>Teams</h1>
            <AddTeamSheet onCreated={() => router.invalidate()}>
              {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
                  `px-2.5`, which renders the 68px control at 72px. */}
              <Button className="shrink-0 gap-1.5 px-2.5!">
                <Plus aria-hidden />
                Add
              </Button>
            </AddTeamSheet>
          </div>

          <TabsList aria-label="Filter teams by status">
            {/* `flex-none` — the triggers hug their labels, as the design draws
                them at 56px and 92px; the shared component stretches them to
                share the list evenly. */}
            <TabsTrigger value="active" className="flex-none">
              Active
            </TabsTrigger>
            <TabsTrigger value="deactivated" className="flex-none">
              Deactivated
            </TabsTrigger>
          </TabsList>
        </div>

        {STATUSES.map((status) => (
          <TabsContent key={status} value={status}>
            <div className={RESOURCE_TABLE_WRAP}>
              {/* The design lays the table on a fixed 248px grid, so a long team
                  name truncates rather than pushing `Status` and `Created` out
                  of place. The trailing column is the one the design reserves
                  for the row menu. */}
              <Table className="table-fixed text-xs">
                <TableHeader>
                  <ResourceHeaderRow>
                    <ResourceHeadCell className={COLUMN}>Name</ResourceHeadCell>
                    <ResourceHeadCell className={COLUMN}>Status</ResourceHeadCell>
                    <ResourceHeadCell className={COLUMN}>Created</ResourceHeadCell>
                    <ResourceMenuHead className={COLUMN} />
                  </ResourceHeaderRow>
                </TableHeader>
                <TableBody>
                  {teams.length === 0 ? (
                    <ResourceEmptyRow colSpan={4}>{emptyMessage(search)}</ResourceEmptyRow>
                  ) : (
                    teams.map((team) => (
                      // The whole row opens the team. The name is a real link so
                      // the row is reachable by keyboard and the target shows in
                      // the status bar; the row handler is the pointer
                      // affordance on top of it, and `opensRow` keeps it out of
                      // the link's way.
                      <ResourceRow
                        key={team.id}
                        onOpen={() =>
                          void navigate({ to: "/teams/$teamId", params: { teamId: team.id } })
                        }
                      >
                        <TableCell className={`${RESOURCE_CELL} truncate`}>
                          <Link
                            to="/teams/$teamId"
                            params={{ teamId: team.id }}
                            className={RESOURCE_ROW_LINK}
                          >
                            <Box aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
                            {team.name}
                          </Link>
                        </TableCell>
                        <TableCell className={RESOURCE_CELL}>
                          <StatusBadge status={team.status} />
                        </TableCell>
                        <TableCell className={RESOURCE_CELL_MUTED}>
                          {formatDate(team.created_at)}
                        </TableCell>
                        <TableCell className={`${RESOURCE_CELL} text-right`}>
                          <RowActions teamId={team.id} name={team.name} />
                        </TableCell>
                      </ResourceRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <LoadMore paging={paging} />
          </TabsContent>
        ))}
      </Tabs>
    </ResourcePage>
  );
}

/** What an empty table means depends on which tab asked for it. */
function emptyMessage({ status }: TeamsSearch): string {
  return status === "active" ? "No active teams yet." : "No deactivated teams.";
}

/**
 * The row menu.
 *
 * One item today — the same shape the schema list ships — because `View team` is
 * the only action the API can serve from here: `DELETE /teams/{team_id}`
 * deactivates rather than deletes, and deactivating is deprioritised. The row
 * itself opens the team as well; the menu is where a second action lands when
 * there is one, and it keeps this list consistent with the others.
 */
function RowActions({ teamId, name }: { teamId: string; name: string }) {
  return (
    <RowMenu name={name}>
      <DropdownMenuItem asChild>
        <Link to="/teams/$teamId" params={{ teamId }}>
          View team
        </Link>
      </DropdownMenuItem>
    </RowMenu>
  );
}
