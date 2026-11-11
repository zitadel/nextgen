import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Plus, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { AddUserSheet } from "@/features/users/components/add-user-sheet";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_MENU_CELL_NARROW,
  RESOURCE_STICKY_BODY,
  RESOURCE_STICKY_END,
  RESOURCE_STICKY_START,
  RESOURCE_TABLE_SCROLL,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceMenuHead,
  ResourceRow,
  ResourceTitle,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import {
  USER_CLAMP,
  UserAttributesCell,
  UserIdCell,
  UserIdentityCell,
} from "@/features/users/components/user-cells";
import { IdText } from "@/components/id-text";
import { SearchField } from "@/components/search-field";
import { ResourceFilter } from "@/components/resource-filter";
import { usersFilters } from "@/features/users/filters";
import { parseDateFilter } from "@/lib/resource-filter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { useScrollEdges } from "@/hooks/use-scroll-edges";
import { useRequiredProjectScope } from "@/features/projects/project-scope";
import { columnsForUsers, fetchUsers } from "@/features/users/api";
import {
  type ColumnGroup,
  type UsersSearch,
  attributeSummary,
  columnsBeyondIdentity,
  isFiltered,
  parseUserStatus,
  pinnedColumns,
  toUserRow,
} from "@/features/users/list";
import { Page } from "@/components/layout";
import { searchTerm } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { useColumnPins } from "@/features/users/column-pins";
import { latestDocuments, loadUsers, useUserSearch } from "@/features/users/load";
import {
  ColumnsContextMenu,
  keepLinkMenu,
  keepLinkPress,
} from "@/features/users/components/columns-context-menu";
import { TeamCell } from "@/features/users/components/team-cell";
import { UserRowActions } from "@/features/users/components/user-row-actions";

/** The filter's earlier `Latest only` choice; the newest revision is picked by its id now. */
const LEGACY_LATEST = "latest";

export const Route = createFileRoute("/_authed/users/")({
  // `User`, not `Users`: the single-person glyph. The plural two-person one
  // reads as a group.
  // Order 3: Teams sits at 2.
  staticData: { scope: "project", nav: { label: "Users", order: 3, icon: User } },
  // The filter lives in the URL, as the Teams tabs do: it is a server-side
  // filter, so it belongs to the request the loader makes, is linkable and
  // survives a reload. Only what the filter can send is kept: a revision
  // belongs to a schema, so it goes without one, and `latest`, which earlier
  // links carry, names no revision.
  validateSearch: (search: Record<string, unknown>): UsersSearch => {
    const schema = typeof search.schema === "string" && search.schema ? search.schema : undefined;
    const revision =
      schema &&
      typeof search.revision === "string" &&
      search.revision &&
      search.revision !== LEGACY_LATEST
        ? search.revision
        : undefined;
    // Every key, even unset: the router lays this over the raw search, so a
    // key left out would keep the URL's value.
    return {
      q: searchTerm(search.q),
      schema,
      revision,
      status: parseUserStatus(search.status),
      created: parseDateFilter(search.created),
    };
  },
  // The search term is left out of the deps, so a new term is not a new match:
  // past the router's pending delay a new match swaps the screen for the pending
  // state, and the field being typed in goes with it. Staying on a match does not
  // reload it, so the screen reads a term that comes after the load itself, once.
  // A first load keeps the delay.
  loaderDeps: ({ search: { q: _q, ...deps } }) => deps,
  // `location.search` is the URL's, which `validateSearch` has not been over.
  loader: ({ deps, location }) =>
    loadUsers({ ...deps, q: searchTerm((location.search as { q?: unknown }).q) }),
  component: UsersScreen,
});

/** One fetched page, with the list state it carries besides its rows. */
interface UsersPage {
  items: Record<string, unknown>[];
  nextPageToken?: string;
  columns: ColumnGroup[];
  teamsExpanded: boolean;
}

function UsersScreen() {
  const projectId = useRequiredProjectScope();
  const fromRoute = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();

  const { loaded, searching, searchError } = useUserSearch(search, fromRoute);
  const searchField = useRef<HTMLInputElement>(null);
  const onSearch = useCallback(
    (q: string) =>
      void navigate({
        search: (prev) => ({ ...prev, q: q || undefined }),
        // Each pause in typing is not a place to come back to.
        replace: true,
      }),
    [navigate],
  );

  const [columns, setColumns] = useState(loaded.columns);
  const [teamsExpanded, setTeamsExpanded] = useState(loaded.teamsExpanded);
  useEffect(() => {
    setColumns(loaded.columns);
    setTeamsExpanded(loaded.teamsExpanded);
  }, [loaded]);

  const paging = useLoadMore(
    loaded,
    async (pageToken): Promise<UsersPage> => {
      const page = await fetchUsers(projectId, pageToken, teamsExpanded, loaded.filter);
      return {
        items: page.users,
        nextPageToken: page.next_page_token ?? undefined,
        // A later page can carry a schema the first page never referenced, whose
        // properties the Columns menu would otherwise not offer.
        columns: await columnsForUsers(
          projectId,
          [...users, ...page.users],
          latestDocuments(loaded.options),
        ),
        teamsExpanded: page.teamsExpanded,
      };
    },
    "Could not load more users.",
    (page) => {
      setColumns(page.columns);
      // A later page can be served without the expansion the first page carried
      // — a permission revoked mid-list — and a Member of column standing over
      // blank cells would read as "these users are on no team".
      setTeamsExpanded((current) => current && page.teamsExpanded);
    },
  );

  const users = useMemo(() => [...loaded.users, ...paging.extra], [loaded.users, paging.extra]);

  const rows = useMemo(
    () => users.map((user, index) => toUserRow(user, index, columns)),
    [users, columns],
  );
  // What the Columns menu offers, per schema: each value reads once per row, so
  // a property that only repeats what the User cell already shows is not
  // offered (under the default schema, the email; D20).
  const pickable = useMemo(
    () =>
      columns
        .map((group) => ({
          ...group,
          fields: columnsBeyondIdentity(
            group.fields,
            rows.filter((row) => row.schemaId === group.schemaId),
          ),
        }))
        .filter((group) => group.fields.length > 0),
    [columns, rows],
  );
  const [pins, togglePin] = useColumnPins(projectId);
  // Schema properties are hidden until the viewer pins them (D23); everything
  // else a row holds reads in its one bounded Attributes cell.
  const pinned = useMemo(() => pinnedColumns(pickable, pins), [pickable, pins]);
  const summaries = useMemo(
    () => rows.map((row) => ({ row, summary: attributeSummary(row, pinned) })),
    [rows, pinned],
  );
  const showAttributes = summaries.some(
    ({ summary }) => summary.entries.length > 0 || summary.more > 0,
  );
  // Latched for the screen's lifetime, as on Projects: a cleared search drops
  // `?q=` before the full list is back, and the field must not unmount in
  // between. A project with no users has nothing to search.
  const [searchable, setSearchable] = useState(false);
  if (!searchable && (rows.length > 0 || search.q || isFiltered(search))) setSearchable(true);
  const scroll = useScrollEdges();
  const filters = useMemo(
    () => usersFilters({ options: loaded.options, revisions: loaded.revisions, search }),
    [loaded.options, loaded.revisions, search],
  );
  // Each row's schema, for the identity card's title and the attributes
  // popover's field labels.
  const schemas = useMemo(
    () => new Map(columns.map((group) => [group.schemaId, group])),
    [columns],
  );

  return (
    <Page>
      <ResourceTitle
        filter={
          <>
            {searchable && (
              <SearchField
                inputRef={searchField}
                query={search.q ?? ""}
                onSearch={onSearch}
                label="Search by identifier"
                className="grow basis-48 @3xl/title-row:max-w-48"
              />
            )}
          </>
        }
        below={
          <ResourceFilter
            filters={filters}
            values={search}
            onChange={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })}
          />
        }
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

      {/* The pinned columns give the table no fixed width. The ID gives way
          first; more pinned columns than fit scroll the table horizontally
          rather than compressing cells. The row menu (and from 640px the User
          column) stays pinned to the card's edge while the rest scrolls under
          it, so the menu is reachable at any width. Right-clicking the table
          opens the Columns menu. */}
      <FormError message={searchError} className="mb-3" />
      <ColumnsContextMenu groups={pickable} pins={pins} onToggle={togglePin}>
        <div
          ref={scroll.ref}
          data-scroll-start={scroll.edges.start || undefined}
          data-scroll-end={scroll.edges.end || undefined}
          aria-busy={searching || undefined}
          className={cn(
            `${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP} ${RESOURCE_TABLE_SCROLL}`,
            searching && "opacity-60",
          )}
        >
          <Table className="text-xs" onContextMenu={keepLinkMenu} onPointerDown={keepLinkPress}>
            <TableHeader>
              <ResourceHeaderRow>
                <ResourceHeadCell className={RESOURCE_STICKY_START}>User</ResourceHeadCell>
                {/* The revision the user is on (#1669): the schema id, since a
                    revision is a schema of its own. It opens that schema. */}
                <ResourceHeadCell>Revision</ResourceHeadCell>
                {pinned.map((column) => (
                  <ResourceHeadCell key={column.key}>{column.label}</ResourceHeadCell>
                ))}
                {showAttributes && <ResourceHeadCell>Attributes</ResourceHeadCell>}
                <ResourceHeadCell>Status</ResourceHeadCell>
                {/* After `Status`, where the design's column order puts it.
                    Memberships, not ownership: the team that owns a user's
                    lifecycle is a different relation (ADR 024), in the User
                    cell's hover card (D23). */}
                {teamsExpanded && <ResourceHeadCell>Member of</ResourceHeadCell>}
                <ResourceHeadCell>ID</ResourceHeadCell>
                <ResourceMenuHead narrow className={RESOURCE_STICKY_END} />
              </ResourceHeaderRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <ResourceEmptyRow
                  colSpan={pinned.length + (showAttributes ? 1 : 0) + (teamsExpanded ? 6 : 5)}
                >
                  {loaded.q || isFiltered(search) ? (
                    // On a phone the empty table still scrolls sideways, so the
                    // message and its control hold to the visible edge rather
                    // than center on a width that is partly out of view.
                    <span className="sticky left-0 flex w-fit flex-wrap items-center gap-x-3 gap-y-2 sm:static sm:mx-auto">
                      {loaded.q ? "No users match this search." : "No users match this filter."}
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          // This button goes with the row, so focus goes first.
                          searchField.current?.focus();
                          void navigate({
                            search: (prev) => ({
                              ...prev,
                              q: undefined,
                              schema: undefined,
                              revision: undefined,
                              status: undefined,
                              created: undefined,
                            }),
                          });
                        }}
                      >
                        Clear filters
                      </Button>
                    </span>
                  ) : (
                    "No users yet."
                  )}
                </ResourceEmptyRow>
              ) : (
                summaries.map(({ row: user, summary }) => (
                  <ResourceRow key={user.id} className="group">
                    <UserIdentityCell
                      user={user}
                      sticky
                      card={{
                        schemaTitle: schemas.get(user.schemaId)?.title ?? user.schemaId,
                        teamsKnown: teamsExpanded,
                      }}
                    />
                    <TableCell className={`${RESOURCE_CELL_MUTED} ${USER_CLAMP}`}>
                      {user.schemaId ? (
                        <Link
                          to="/schemas/$schemaId"
                          params={{ schemaId: user.schemaId }}
                          title={user.schemaId}
                          className="hover:text-foreground flex min-w-0 underline-offset-2 hover:underline"
                        >
                          <IdText id={user.schemaId} />
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {pinned.map((column) => (
                      <TableCell
                        key={column.key}
                        className={`${RESOURCE_CELL_MUTED} ${USER_CLAMP}`}
                      >
                        {user.values[column.key] ?? "—"}
                      </TableCell>
                    ))}
                    {showAttributes && (
                      <UserAttributesCell
                        user={user}
                        summary={summary}
                        schema={schemas.get(user.schemaId)?.schema}
                      />
                    )}
                    <TableCell className={RESOURCE_CELL}>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    {teamsExpanded && (
                      <TableCell className={`${RESOURCE_CELL_MUTED} ${USER_CLAMP}`}>
                        <TeamCell teams={user.teams} truncated={user.teamsTruncated} />
                      </TableCell>
                    )}
                    <UserIdCell user={user} />
                    <TableCell
                      className={cn(
                        RESOURCE_MENU_CELL_NARROW,
                        RESOURCE_STICKY_END,
                        RESOURCE_STICKY_BODY,
                      )}
                    >
                      <UserRowActions
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
      </ColumnsContextMenu>
      {/* Full width and `secondary`, 24px under the table, not a centred pill. */}
      <LoadMore paging={paging} />
    </Page>
  );
}
