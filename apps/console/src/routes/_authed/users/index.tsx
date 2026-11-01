import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Box, MoreVertical, Plus, User } from "lucide-react";
import {
  Fragment,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AddUserSheet } from "@/components/add-user-sheet";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
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
  RowMenu,
} from "@/components/resource-list";
import { StatusBadge } from "@/components/status-badge";
import {
  USER_CLAMP,
  UserAttributesCell,
  UserIdCell,
  UserIdentityCell,
} from "@/components/user-cells";
import { UsersFilter } from "@/components/users-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { useScrollEdges } from "@/hooks/use-scroll-edges";
import { requireProjectScope, useRequiredProjectScope } from "@/lib/project-scope";
import { fetchAllSchemas, fetchSchemaRevisions } from "@/lib/schema";
import type { UserSchema } from "@/lib/schema";
import type { UserTeam } from "@/lib/user";
import {
  type ColumnGroup,
  type ColumnPins,
  type SchemaOption,
  type UsersSearch,
  attributeSummary,
  columnsBeyondIdentity,
  columnsForUsers,
  fetchUsers,
  pinnedColumns,
  readColumnPins,
  schemaOptions,
  toUserRow,
  userFilter,
  userSorting,
  writeColumnPins,
} from "@/lib/user-list";
import { Page } from "@/components/layout";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/users/")({
  // `User`, not `Users`: the single-person glyph. The plural two-person one
  // reads as a group.
  // Order 3: Teams sits at 2.
  staticData: { scope: "project", nav: { label: "Users", order: 3, icon: User } },
  // The filter and the order live in the URL, as the Teams tabs do: both go
  // to the server, so they belong to the request the loader makes, are
  // linkable and survive a reload. Only what can be sent is kept: a revision
  // belongs to a schema, so it goes without one.
  validateSearch: (search: Record<string, unknown>): UsersSearch => {
    const schema = typeof search.schema === "string" && search.schema ? search.schema : undefined;
    const revision =
      schema && typeof search.revision === "string" && search.revision
        ? search.revision
        : undefined;
    return {
      ...(schema ? { schema } : {}),
      ...(revision ? { revision } : {}),
      ...(search.sort === "latest" || search.sort === "oldest" ? { sort: search.sort } : {}),
    };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    if (deps.revision && deps.sort) {
      // One revision sends no order, so a URL keeping one would claim an
      // order the list does not apply.
      throw redirect({ to: "/users", search: { ...deps, sort: undefined } });
    }
    // The filter's options are the project's schemas at their latest revision;
    // the chosen schema's revisions, with whether each is in use, are read for
    // it alone. Both are chrome: unreadable, the list still renders, narrowed
    // by what the URL carries.
    const filter = userFilter(deps);
    const sorting = userSorting(deps);
    const [page, options, revisions] = await Promise.all([
      fetchUsers(projectId, undefined, true, filter, sorting),
      fetchAllSchemas(projectId).then(schemaOptions, () => []),
      deps.schema
        ? fetchSchemaRevisions(projectId, deps.schema, { inUse: true }).catch(() => [])
        : [],
    ]);
    return {
      users: page.users,
      teamsExpanded: page.teamsExpanded,
      nextPageToken: page.next_page_token ?? undefined,
      columns: await columnsForUsers(projectId, page.users, latestDocuments(options)),
      options,
      revisions,
      filter,
      sorting,
    };
  },
  component: UsersScreen,
});

/** The latest revisions' documents, keyed by id: what `columnsForUsers` need not read again. */
function latestDocuments(options: SchemaOption[]): Map<string, UserSchema> {
  return new Map(options.map((option) => [option.latestId, option.schema]));
}

/** One fetched page, with the list state it carries besides its rows. */
interface UsersPage {
  items: Record<string, unknown>[];
  nextPageToken?: string;
  columns: ColumnGroup[];
  teamsExpanded: boolean;
}

function UsersScreen() {
  const projectId = useRequiredProjectScope();
  const loaded = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
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
      const page = await fetchUsers(
        projectId,
        pageToken,
        teamsExpanded,
        loaded.filter,
        loaded.sorting,
      );
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
  const scroll = useScrollEdges();
  // Each row's schema, for the identity card's title and the attributes
  // popover's field labels.
  const schemas = useMemo(
    () => new Map(columns.map((group) => [group.schemaId, group])),
    [columns],
  );

  return (
    <Page>
      {/* No search beside the title: it is out of the page headers until there
          is a console-wide solution (D19). */}
      <ResourceTitle
        filter={
          <UsersFilter
            options={loaded.options}
            revisions={loaded.revisions}
            search={search}
            onChange={(next) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  schema: next.schema,
                  revision: next.revision,
                  sort: next.sort,
                }),
              })
            }
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
      <ColumnsContextMenu groups={pickable} pins={pins} onToggle={togglePin}>
        <div
          ref={scroll.ref}
          data-scroll-start={scroll.edges.start || undefined}
          data-scroll-end={scroll.edges.end || undefined}
          className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP} ${RESOURCE_TABLE_SCROLL}`}
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
                {/* 52px: the 36px menu button and 8px either side. The cell
                  inset the other columns take would make this pinned column
                  84px wide for one icon. */}
                <ResourceMenuHead className={`w-13 px-2 ${RESOURCE_STICKY_END}`} />
              </ResourceHeaderRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <ResourceEmptyRow
                  colSpan={pinned.length + (showAttributes ? 1 : 0) + (teamsExpanded ? 6 : 5)}
                >
                  {search.schema ? "No users match this filter." : "No users yet."}
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
                          className="hover:text-foreground block truncate underline-offset-2 hover:underline"
                        >
                          {user.schemaId}
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
                        RESOURCE_CELL,
                        "px-2",
                        RESOURCE_STICKY_END,
                        RESOURCE_STICKY_BODY,
                      )}
                    >
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
      </ColumnsContextMenu>
      {/* Full width and `secondary`, 24px under the table, not a centred pill. */}
      <LoadMore paging={paging} />
    </Page>
  );
}

/**
 * The viewer's pinned columns for the selected project, kept in their browser
 * (`readColumnPins`). A toggle takes effect at once and is persisted when it
 * can be; without storage it lasts until the page is left.
 */
function useColumnPins(projectId: string): [ColumnPins, (schemaId: string, key: string) => void] {
  const [state, setState] = useState(() => ({ projectId, pins: readColumnPins(projectId) }));
  // Switching project swaps in that project's pins rather than carrying over
  // another project's: schema ids are unique per project only. Read once, as
  // the render that sees the new project adjusts the state.
  if (state.projectId !== projectId) {
    setState({ projectId, pins: readColumnPins(projectId) });
  }

  const toggle = useCallback(
    (schemaId: string, key: string) => {
      const current = state.pins[schemaId] ?? [];
      const pins = {
        ...state.pins,
        [schemaId]: current.includes(key)
          ? current.filter((pinned) => pinned !== key)
          : [...current, key],
      };
      writeColumnPins(state.projectId, pins);
      setState({ projectId: state.projectId, pins });
    },
    [state],
  );

  return [state.pins, toggle];
}

/**
 * The Columns menu, opened by right-clicking the table (a long press on touch,
 * the context-menu key or Shift+F10 on a focused control in it): a checkbox
 * per schema property, pinning it as its own column. Grouped under each
 * schema's title when the loaded users mix schemas, since a pin belongs to one
 * schema's property.
 *
 * Selecting an item keeps the menu open, so several can be pinned in one go.
 * With nothing to offer, the table keeps the browser's own menu.
 */
function ColumnsContextMenu({
  groups,
  pins,
  onToggle,
  children,
}: {
  groups: ColumnGroup[];
  pins: ColumnPins;
  onToggle: (schemaId: string, key: string) => void;
  children: ReactNode;
}) {
  if (groups.length === 0) return children;
  const grouped = groups.length > 1;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="max-h-[min(24rem,var(--radix-context-menu-content-available-height))] w-56">
        <ContextMenuLabel>Columns</ContextMenuLabel>
        {groups.map((group) => (
          <Fragment key={group.schemaId}>
            <ContextMenuSeparator />
            {grouped && (
              <ContextMenuLabel className="text-muted-foreground truncate text-xs font-normal">
                {group.title}
              </ContextMenuLabel>
            )}
            {group.fields.map((entry) => (
              <ContextMenuCheckboxItem
                key={entry.key}
                checked={pins[group.schemaId]?.includes(entry.key) ?? false}
                onCheckedChange={() => onToggle(group.schemaId, entry.key)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="truncate">{entry.label}</span>
              </ContextMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A right-click on a link keeps the browser's own menu (open in a new tab,
 * copy the link) rather than the Columns menu: stopping the event here, under
 * the trigger, never prevents its default.
 */
function keepLinkMenu(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest("a")) event.stopPropagation();
}

/**
 * The same for a long press on touch or pen, which the trigger opens from its
 * own timer on `pointerdown` rather than from `contextmenu`: a press on a
 * link never starts it, so only the browser's link menu opens.
 */
function keepLinkPress(event: PointerEvent) {
  if (event.pointerType !== "mouse") keepLinkMenu(event);
}

/**
 * The teams a user belongs to, glyphed the way the design draws the cell and the
 * way the Teams directory draws a team row. A membership that is not active yet
 * (`pending`) or any more (`inactive`) says so: the roster returns them beside
 * the active ones, and an unmarked name would read as a full member.
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
            {team.status && team.status !== "active" && (
              <Badge
                variant="outline"
                className="text-muted-foreground ml-1 h-4 rounded-sm border-dashed px-1 align-middle text-[11px] font-normal"
              >
                {team.status}
              </Badge>
            )}
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
