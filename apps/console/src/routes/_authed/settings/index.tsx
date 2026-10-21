import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Box, ChevronRight, LayoutGrid } from "lucide-react";
import { useMemo } from "react";

import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import { DETAIL_TITLE } from "@/components/detail-page";
import { Page } from "@/components/layout";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { EYEBROW, PAGE_TITLE_ROW } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useSessionCached } from "@/hooks/use-async";
import { useLoadMore } from "@/hooks/use-load-more";
import { readAccountTeam } from "@/lib/account";
import { formatDate } from "@/lib/date";

/**
 * Account settings → Overview: the teams the signed-in person is on, from their
 * own roster (`GET /users/me/teams`, no grant needed). The one the sidebar
 * footer names (`lib/account.ts`) is badged as their account, tying the two
 * together. Each row opens the team's settings — the chevron says so — and
 * the sidebar nests the open team under Overview.
 *
 * It is where the account dropdown's way into Settings lands, and the route
 * that puts the shell into its Settings view.
 */
export const Route = createFileRoute("/_authed/settings/")({
  staticData: { nav: { label: "Overview", order: 0, icon: LayoutGrid, view: "settings" } },
  loader: async () => {
    const page = await api.listMyTeams({ limit: PAGE_SIZE, ...consoleSessionProject() });
    return { teams: page.teams, nextPageToken: page.next_page_token ?? undefined };
  },
  component: OverviewScreen,
});

/** One page of the roster; `Load more` walks the rest (decisions log D5). */
const PAGE_SIZE = 25;

function OverviewScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate();
  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      const page = await api.listMyTeams({
        limit: PAGE_SIZE,
        page_token: pageToken,
        ...consoleSessionProject(),
      });
      return { items: page.teams, nextPageToken: page.next_page_token ?? undefined };
    },
    "Could not load more teams.",
  );
  const teams = useMemo(() => [...loaded.teams, ...paging.extra], [loaded.teams, paging.extra]);
  const account = useSessionCached(readAccountTeam, null);

  return (
    <Page>
      <div className={PAGE_TITLE_ROW}>
        <h1 className={DETAIL_TITLE}>Overview</h1>
      </div>
      <div className={RESOURCE_TABLE_TOP}>
        <h2 className={EYEBROW}>Teams</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The teams you are on. Open one to manage it.
        </p>
      </div>
      <div className={`${RESOURCE_TABLE_WRAP} mt-4`}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>Team</ResourceHeadCell>
              <ResourceHeadCell>Membership</ResourceHeadCell>
              <ResourceHeadCell>Joined</ResourceHeadCell>
              <ResourceMenuHead className="w-15" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {teams.length === 0 ? (
              <ResourceEmptyRow colSpan={4}>You are not on a team yet.</ResourceEmptyRow>
            ) : (
              teams.map((team) => (
                // The whole row opens the team, as on Teams; the name is the
                // real link for the keyboard and the status bar.
                <ResourceRow
                  key={team.id}
                  onOpen={() =>
                    void navigate({ to: "/settings/teams/$teamId", params: { teamId: team.id } })
                  }
                >
                  <TableCell className={`${RESOURCE_CELL} w-full max-w-0`}>
                    {/* The badge sits beside the link, not in it, so the link
                        is named by the team alone; the name gives way first. */}
                    <span className="flex min-w-0 items-center gap-2">
                      <Link
                        to="/settings/teams/$teamId"
                        params={{ teamId: team.id }}
                        className={`${RESOURCE_ROW_LINK} min-w-0`}
                      >
                        <Box aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
                        <span className="truncate">{team.name}</span>
                      </Link>
                      {team.id === account?.id && <Badge variant="secondary">Your account</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={team.membership_status} />
                  </TableCell>
                  <TableCell className={RESOURCE_CELL_MUTED}>
                    {formatDate(team.created_at)}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <ChevronRight aria-hidden className="ml-auto size-4 text-muted-foreground" />
                  </TableCell>
                </ResourceRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <LoadMore paging={paging} />
    </Page>
  );
}
