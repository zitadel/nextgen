import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Box, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AddTeamSheet } from "@/components/add-team-sheet";
import {
  RESOURCE_CELL,
  RESOURCE_HEADER,
  RESOURCE_PAGE,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
  opensRow,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { api } from "../../../api/zitadel";
import { formatDate } from "../../../lib/date";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/teams/")({
  staticData: { nav: { label: "Teams", order: 2, icon: Box } },
  loader: async () => {
    const page = await api.queryTeams(
      { limit: PAGE_SIZE },
      { project_id: getConsoleProjectId() },
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
 * column is the one the design reserves for the row menu: the menu is not built,
 * but the grid keeps its place so the three data columns land where the design
 * puts them.
 */
const COLUMN = "w-[248px]";

type Team = Awaited<ReturnType<typeof api.queryTeams>>["teams"][number];

function TeamsScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();

  // Pages fetched after the first live here rather than in the loader, so `Load
  // more` appends without re-running it and a route invalidation resets to the
  // first page — the honest thing to show once the set has changed underneath.
  const [extra, setExtra] = useState<Team[]>([]);
  const [nextPageToken, setNextPageToken] = useState(loaded.nextPageToken);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setExtra([]);
    setNextPageToken(loaded.nextPageToken);
  }, [loaded]);

  // The loader hands back a new object on every invalidation, so its identity is
  // the generation of the list on screen. `loadMore` reads it after awaiting to
  // tell whether the page it fetched still belongs to the set it asked for.
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  const teams = [...loaded.teams, ...extra];

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    const generation = loaded;
    setLoadingMore(true);
    try {
      const page = await api.queryTeams(
        { limit: PAGE_SIZE, page_token: nextPageToken },
        { project_id: getConsoleProjectId() },
      );
      // A page that lands after the list was invalidated answers a question about
      // the previous set; appending it would re-add rows the server may no longer
      // return. It is dropped, leaving the button ready to fetch the current
      // page 2.
      if (loadedRef.current !== generation) return;
      setExtra((current) => [...current, ...page.teams]);
      setNextPageToken(page.next_page_token ?? undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div
        className={`${RESOURCE_HEADER} flex flex-col gap-4 lg:h-9 lg:flex-row lg:items-center lg:justify-between`}
      >
        <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">Teams</h1>
        <AddTeamSheet onCreated={() => router.invalidate()}>
          {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
              `px-2.5`, which renders the 68px control at 72px. */}
          <Button className="w-full gap-1.5 px-2.5! lg:w-auto">
            <Plus aria-hidden />
            Add
          </Button>
        </AddTeamSheet>
      </div>

      {/* The design's search box and `Active`/`Inactive` tabs are not built:
          `POST /teams/query` filters on `created_at` only, so both would narrow
          the fetched page while presenting themselves as narrowing the set —
          the reason D5 keeps filtering out of the MVP. They arrive when `name`
          and `status` become filterable server-side. */}
      <div className={`${RESOURCE_TABLE_WRAP} mt-4`}>
        {/* The design lays the table on a fixed 248px grid, so a long team name
            truncates rather than pushing `Status` and `Created` out of place.
            The trailing column is the one the design reserves for the row menu:
            the menu itself is not built, but the grid keeps its place so the
            three data columns land where the design puts them. */}
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow className="border-border border-b hover:bg-transparent">
              <ResourceHeadCell className={COLUMN}>Name</ResourceHeadCell>
              <ResourceHeadCell className={COLUMN}>Status</ResourceHeadCell>
              <ResourceHeadCell className={COLUMN}>Created</ResourceHeadCell>
              <TableHead className={`${COLUMN} h-14 px-6`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.length === 0 ? (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell colSpan={4} className="text-muted-foreground h-24 text-center">
                  No teams yet.
                </TableCell>
              </TableRow>
            ) : (
              teams.map((team) => (
                // The whole row opens the team. The name is a real link so the
                // row is reachable by keyboard and the target shows in the status
                // bar; the row handler is the pointer affordance on top of it,
                // and `opensRow` keeps it out of the link's way.
                <TableRow
                  key={team.id}
                  className="hover:bg-muted/40 cursor-pointer border-0"
                  onClick={(event) => {
                    if (opensRow(event)) {
                      void navigate({ to: "/teams/$teamId", params: { teamId: team.id } });
                    }
                  }}
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
                  <TableCell className={`${RESOURCE_CELL} text-muted-foreground truncate text-sm`}>
                    {formatDate(team.created_at)}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL} />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* D5: `Load more` rather than pagination controls. The button's presence
          means there is more; its absence means the list is complete. */}
      {nextPageToken && (
        <Button
          variant="secondary"
          className="mt-6 h-9 w-full gap-1.5 px-2.5"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Load more
        </Button>
      )}
    </div>
  );
}

