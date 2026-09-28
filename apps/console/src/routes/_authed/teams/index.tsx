import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Box, Ellipsis, Loader2, Plus, Search } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { api } from "../../../api/zitadel";
import { formatDate } from "../../../lib/date";
import { getConsoleProjectId } from "../../../runtime/runtime";

/**
 * The two states `team-status` defines. The tabs filter on exactly these, so the
 * screen never shows a state the API does not have — the design's table draws
 * the second one as `Inactive`, but its own tab already writes `Deactivated`.
 */
const STATUSES = ["active", "deactivated"] as const;
type TeamStatus = (typeof STATUSES)[number];

type TeamsSearch = { status: TeamStatus; q?: string };

export const Route = createFileRoute("/_authed/teams/")({
  staticData: { nav: { label: "Teams", order: 2, icon: Box } },
  // The tab and the search term live in the URL: both are server-side filters,
  // so they belong to the request the loader makes rather than to component
  // state. A filtered list is then linkable, survives a reload, and moves with
  // the back button — and changing either re-runs the loader, which resets the
  // paged-in rows the way a create or a delete does.
  validateSearch: (search: Record<string, unknown>): TeamsSearch => {
    const q = typeof search.q === "string" ? search.q.trim() : "";
    return {
      status: STATUSES.find((status) => status === search.status) ?? "active",
      q: q === "" ? undefined : q,
    };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const page = await api.queryTeams(
      { limit: PAGE_SIZE, filter: teamFilter(deps) },
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

/** How long typing settles before the URL — and so the request — moves. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The design lays this table on a fixed 248px grid, so a long team name
 * truncates rather than pushing `Status` and `Created` out of place. The fourth
 * column is the one the design reserves for the row menu, and keeps the three
 * data columns where the design puts them.
 */
const COLUMN = "w-[248px]";

type Team = Awaited<ReturnType<typeof api.queryTeams>>["teams"][number];
type TeamFilter = NonNullable<Parameters<typeof api.queryTeams>[0]["filter"]>;

/**
 * The filter both the loader and `Load more` send.
 *
 * `contains` is a case-insensitive substring match on every team in the project,
 * not on the page already fetched — which is what let the search box be built at
 * all. D5 keeps client-side filtering out precisely because it would narrow the
 * loaded page while presenting itself as narrowing the set.
 */
function teamFilter({ status, q }: TeamsSearch): TeamFilter {
  const filter: TeamFilter = [{ field: "status", operation: "equals", value: status }];
  if (q) filter.push({ field: "name", operation: "contains", value: q });
  return filter;
}

function TeamsScreen() {
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
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
        // The same filter the token was issued under: a page token answers one
        // question, and asking a different one with it is not a narrower list
        // but a meaningless one.
        { limit: PAGE_SIZE, page_token: nextPageToken, filter: teamFilter(search) },
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
            the frame gives the stacked header more room. */}
        <div className={`${RESOURCE_HEADER} flex flex-col gap-6 lg:gap-2`}>
          <div className="flex flex-col gap-2 lg:h-9 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">Teams</h1>
            <div className="flex items-center gap-3">
              <TeamSearch value={search.q} />
              <AddTeamSheet onCreated={() => router.invalidate()}>
                {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
                    `px-2.5`, which renders the 68px control at 72px. */}
                <Button className="shrink-0 gap-1.5 px-2.5!">
                  <Plus aria-hidden />
                  Add
                </Button>
              </AddTeamSheet>
            </div>
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
                        {emptyMessage(search)}
                      </TableCell>
                    </TableRow>
                  ) : (
                    teams.map((team) => (
                      // The whole row opens the team. The name is a real link so
                      // the row is reachable by keyboard and the target shows in
                      // the status bar; the row handler is the pointer
                      // affordance on top of it, and `opensRow` keeps it out of
                      // the link's way.
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
                        <TableCell
                          className={`${RESOURCE_CELL} text-muted-foreground truncate text-sm`}
                        >
                          {formatDate(team.created_at)}
                        </TableCell>
                        <TableCell className={`${RESOURCE_CELL} text-right`}>
                          <RowActions teamId={team.id} name={team.name} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* D5: `Load more` rather than pagination controls. The button's
                presence means there is more; its absence means the list is
                complete. */}
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/** What an empty table means depends on which question was asked of it. */
function emptyMessage({ status, q }: TeamsSearch): string {
  if (q) return `No teams match “${q}”.`;
  return status === "active" ? "No active teams yet." : "No deactivated teams.";
}

/**
 * The directory's search box.
 *
 * The field is typed into far faster than a request should be made, so the URL
 * — and with it the loader — moves only once typing settles. The input holds the
 * pending keystrokes in the meantime, and takes a value back from the URL only
 * when the URL moved somewhere the input did not send it (the back button, a
 * link): without that test, a term still being typed would be overwritten by the
 * term that was sent a moment ago.
 */
function TeamSearch({ value }: { value?: string }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const [query, setQuery] = useState(value ?? "");
  const sent = useRef(value ?? "");

  useEffect(() => {
    if ((value ?? "") === sent.current) return;
    sent.current = value ?? "";
    setQuery(value ?? "");
  }, [value]);

  useEffect(() => {
    if (query === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = query;
      void navigate({
        search: (prev) => ({ ...prev, q: query.trim() === "" ? undefined : query.trim() }),
        // One history entry for the search, not one per keystroke.
        replace: true,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, navigate]);

  return (
    <InputGroup className="min-w-0 flex-1 lg:w-[242px] lg:flex-none">
      <InputGroupAddon>
        <Search aria-hidden strokeWidth={1.5} />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        name="team-search"
        placeholder="Search"
        aria-label="Search teams"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </InputGroup>
  );
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem asChild>
          <Link to="/teams/$teamId" params={{ teamId }}>
            View team
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
