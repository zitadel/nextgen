import { ApiError } from "@zitadel/api/runtime/fetch";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Box, Loader2, MoreVertical, Plus, Search, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AddUserSheet } from "@/components/add-user-sheet";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import {
  RESOURCE_CELL,
  RESOURCE_HEADER,
  RESOURCE_PAGE,
  RESOURCE_TABLE_WRAP,
  ResourceHeadCell,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";

import { api } from "../../../api/zitadel";
import { displayValue, field } from "../../../lib/record";
import { type SchemaField, type UserSchema, schemaColumns } from "../../../lib/schema";
import { userAttributes, userDisplayName } from "../../../lib/user";

export const Route = createFileRoute("/_authed/users/")({
  // `User`, not `Users`: the sidebar frame's row carries `lucide/User`, the
  // single-person glyph. The plural two-person one reads as a group.
  // Order 3: Teams sits at 2.
  staticData: { nav: { label: "Users", order: 3, icon: User } },
  loader: async () => {
    const page = await fetchUsers();
    return {
      users: page.users,
      teamsExpanded: page.teamsExpanded,
      nextPageToken: page.next_page_token ?? undefined,
      columns: await columnsForUsers(page.users),
    };
  },
  component: UsersScreen,
});

type UsersPage = Awaited<ReturnType<typeof api.queryUsers>>;

/**
 * One page of users, with each user's team memberships embedded.
 *
 * `expand: ["teams"]` needs `team_membership.read` on top of `user.read`, and a
 * credential carrying one without the other is refused the whole request rather
 * than just the relation (ADR 059). The refusal therefore falls back to the
 * unexpanded read: the screen loses its Team column, not its users.
 */
async function fetchUsers(pageToken?: string): Promise<UsersPage & { teamsExpanded: boolean }> {
  const body = { limit: PAGE_SIZE, page_token: pageToken };
  try {
    return { ...(await api.queryUsers({ ...body, expand: ["teams"] })), teamsExpanded: true };
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 403) throw cause;
    return { ...(await api.queryUsers(body)), teamsExpanded: false };
  }
}

/**
 * One page of users. `POST /users/query` is cursor-paginated, so the size is a page
 * size rather than a cap on what the operator can reach — `Load more` walks the
 * rest (design decisions log D5: a button, not pagination controls).
 */
const PAGE_SIZE = 25;

function isPresent<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/**
 * Columns for a set of users, from the schemas those users reference.
 *
 * Only the loaded users' schemas are fetched, not every schema in the project:
 * one nobody uses would add a column that is blank in every row. Each user
 * carries `schema`, so the set is known without a second list call.
 */
async function columnsForUsers(users: Record<string, unknown>[]): Promise<SchemaField[]> {
  const schemaIds = [...new Set(users.map((user) => field(user, "schema")).filter(isPresent))];
  const schemas = await Promise.all(
    schemaIds.map(async (id) => {
      try {
        return (await api.getSchemaById(id)).schema as UserSchema;
      } catch {
        // One unreadable schema costs its columns, not the screen. The rows
        // still render from the fallback below.
        return undefined;
      }
    }),
  );
  return columnsFor(users, schemas.filter(isPresent));
}

interface UserRow {
  id: string;
  /** Display name for the row menu and the delete dialog — not a column. */
  name: string;
  /** Rendered cell values, keyed by schema property. */
  values: Record<string, string>;
  /** `metadata.status`, absent on a record the server has not stamped. */
  status?: string;
  /** The teams the user belongs to, empty when the user is on none. */
  teams: UserTeam[];
  /** True when the user is on more teams than the embedded list carries. */
  teamsTruncated: boolean;
}

/**
 * Columns from the users' schemas, falling back to the keys the records
 * themselves carry.
 *
 * The fallback matters because the schema fetch is best-effort and because a
 * user may predate its schema. Without it an unreadable schema would render a
 * table of rows with no columns — worse than showing the raw attributes.
 */
function columnsFor(users: Record<string, unknown>[], schemas: UserSchema[]): SchemaField[] {
  const columns = schemaColumns(schemas);
  if (columns.length > 0) return columns;

  const keys = new Set<string>();
  for (const user of users) {
    for (const key of Object.keys(userAttributes(user))) keys.add(key);
  }
  return [...keys].sort().map((key) => ({
    key,
    label: key,
    required: false,
    inputType: "text" as const,
  }));
}

/** Platform-correct modifier for the search shortcut hint (⌘ on Apple, Ctrl elsewhere). */
function searchShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+F";
  const apple =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    /Mac OS|iPhone|iPad|iPod/.test(navigator.userAgent);
  return apple ? "⌘F" : "Ctrl+F";
}

function UsersScreen() {
  const loaded = Route.useLoaderData();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Pages fetched after the first live here rather than in the loader: `Load
  // more` appends without re-running it, and a route invalidation (a delete, a
  // create) resets to the first page, which is the honest thing to show once
  // the set has changed underneath.
  const [extra, setExtra] = useState<Record<string, unknown>[]>([]);
  const [nextPageToken, setNextPageToken] = useState(loaded.nextPageToken);
  const [columns, setColumns] = useState(loaded.columns);
  const [teamsExpanded, setTeamsExpanded] = useState(loaded.teamsExpanded);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setExtra([]);
    setNextPageToken(loaded.nextPageToken);
    setColumns(loaded.columns);
    setTeamsExpanded(loaded.teamsExpanded);
  }, [loaded]);

  // The loader hands back a new object on every invalidation, so its identity is
  // the generation of the list currently on screen. `loadMore` reads it after
  // awaiting to tell whether the page it fetched still belongs to the set it was
  // asked for.
  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  const users = useMemo(() => [...loaded.users, ...extra], [loaded.users, extra]);

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    const generation = loaded;
    setLoadingMore(true);
    try {
      const page = await fetchUsers(nextPageToken);
      // A later page can carry a schema the first page never referenced, which
      // would otherwise render its users with every cell blank.
      const nextColumns = await columnsForUsers([...users, ...page.users]);
      // A delete or a create while this was in flight has already reset the list
      // to a fresh first page. This page answers a question about the previous
      // one — appending it would re-add rows the server no longer returns — so
      // it is dropped, and the button is left ready to fetch the current page 2.
      if (loadedRef.current !== generation) return;
      setExtra((current) => [...current, ...page.users]);
      setNextPageToken(page.next_page_token ?? undefined);
      setColumns(nextColumns);
      // A later page can be served without the expansion the first page carried
      // — a permission revoked mid-list — and a Team column standing over blank
      // cells would read as "these users are on no team".
      setTeamsExpanded((current) => current && page.teamsExpanded);
    } finally {
      setLoadingMore(false);
    }
  }

  // ⌘F / Ctrl+F focuses the table search instead of the browser find bar —
  // only when the event isn't already targeting an editable field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Search narrows the rows already fetched. `POST /users/query` does accept
  // server-side filters, but not a free-text one across schema-driven
  // attributes, so this cannot reach users outside the loaded page — which is
  // why the table says so beneath it.
  //
  // It matches every rendered column rather than a fixed name/email/id triple:
  // the columns are schema-driven, so a hardcoded set would silently fail to
  // search whatever the project's schema actually defines.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.map((user, index) => toUserRow(user, index, columns)).filter((row) => {
      if (needle === "") return true;
      // Team names only while the column is on screen. A later page served
      // without the expansion drops the column while the rows fetched before it
      // keep their memberships, and searching those would filter the table on
      // something the operator cannot see.
      const teams = teamsExpanded ? row.teams.map((team) => team.name) : [];
      return [
        row.id,
        ...teams,
        ...columns.map((column) => row.values[column.key] ?? ""),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [users, query, columns, teamsExpanded]);

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <h1 className={`${RESOURCE_HEADER} text-foreground font-serif text-2xl leading-6 tracking-tight`}>
        Users
      </h1>

      <div
        className={`${RESOURCE_HEADER} mt-6 flex flex-col gap-4 lg:h-10 lg:flex-row lg:items-center lg:justify-end`}
      >
        <div className="flex w-full flex-col gap-2.5 lg:w-auto lg:flex-row lg:items-center lg:gap-3">
          <div className="relative w-full lg:w-[373px]">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            />
            <Input
              ref={searchRef}
              type="search"
              name="user-search"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search users"
              className="pr-14 pl-9"
            />
            <kbd className="bg-muted text-muted-foreground pointer-events-none absolute top-1/2 right-2 flex h-5 -translate-y-1/2 items-center gap-0.5 rounded-sm px-1.5 font-sans text-[10px] font-medium">
              {searchShortcutLabel()}
            </kbd>
          </div>
          <AddUserSheet onCreated={() => router.invalidate()}>
            <Button className="w-full lg:w-auto">
              Add
              <Plus aria-hidden />
            </Button>
          </AddUserSheet>
        </div>
      </div>

      {/* The column set is schema-driven and so has no fixed width; the design
          scrolls the table horizontally rather than compressing cells (the
          `Filled` variant shows a scrollbar under the rows). */}
      <div className={`${RESOURCE_TABLE_WRAP} mt-6`}>
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="border-border border-b hover:bg-transparent">
              {columns.map((column) => (
                <ResourceHeadCell key={column.key}>{column.label}</ResourceHeadCell>
              ))}
              <ResourceHeadCell>Status</ResourceHeadCell>
              {/* After `Status`, where the design's column order puts it. */}
              {teamsExpanded && <ResourceHeadCell>Team</ResourceHeadCell>}
              <ResourceHeadCell>ID</ResourceHeadCell>
              <TableHead className="h-14 w-[60px] px-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell
                  colSpan={columns.length + (teamsExpanded ? 4 : 3)}
                  className="text-muted-foreground h-24 text-center"
                >
                  {users.length === 0 ? "No users yet." : "No users match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((user) => (
                <TableRow key={user.id} className="hover:bg-muted/40 border-0">
                  {columns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={`${RESOURCE_CELL} text-muted-foreground max-w-[280px] truncate text-sm`}
                    >
                      {/* The first column carries the link to the detail screen.
                          There is no separate name column to hang it on — the
                          design's columns are the schema's own properties, and
                          which one comes first depends on the schema. */}
                      {index === 0 ? (
                        <Link
                          to="/users/$userId"
                          params={{ userId: user.id }}
                          className="text-foreground truncate font-medium underline-offset-2 hover:underline"
                        >
                          {user.values[column.key] || user.id}
                        </Link>
                      ) : (
                        (user.values[column.key] ?? "—")
                      )}
                    </TableCell>
                  ))}
                  <TableCell className={RESOURCE_CELL}>
                    <StatusBadge status={user.status} />
                  </TableCell>
                  {teamsExpanded && (
                    <TableCell
                      className={`${RESOURCE_CELL} text-muted-foreground max-w-[280px] truncate text-sm`}
                    >
                      <TeamCell teams={user.teams} truncated={user.teamsTruncated} />
                    </TableCell>
                  )}
                  <TableCell className={`${RESOURCE_CELL} text-foreground truncate text-sm`}>
                    {user.id}
                  </TableCell>
                  <TableCell className={RESOURCE_CELL}>
                    <RowActions
                      userId={user.id}
                      name={user.name}
                      onDeleted={() => router.invalidate()}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {/* D5: `Load more` rather than pagination controls. The button is the only
          signal needed — its presence means there is more, its absence means the
          list is complete.

          Full width and `secondary` per the design (`366:63442` — 963×36 spanning
          the table, 24px below it), not a centred pill. */}
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

function toUserRow(
  user: Record<string, unknown>,
  index: number,
  columns: SchemaField[],
): UserRow {
  const id = field(user, "id") ?? `unknown-user-${index}`;
  const attributes = userAttributes(user);
  const values: Record<string, string> = {};
  for (const column of columns) {
    // Only scalars are read. A property whose value is an object or array has no
    // one-line rendering, and `JSON.stringify` in a table cell is noise — the
    // detail screen is where a structured attribute belongs.
    const value = displayValue(attributes, column.key);
    if (value !== undefined) values[column.key] = value;
  }
  return {
    id,
    values,
    // Used for the row menu's accessible name and the delete dialog's heading,
    // not as a column. Falls back to the email and then the id: a `minimal`
    // schema defines only `email`, so a name is genuinely absent, not missing.
    name: userDisplayName(attributes) ?? field(attributes, "email") ?? id,
    status: userStatus(user),
    teams: userTeams(user),
    teamsTruncated: user.teams_truncated === true,
  };
}

/** One embedded membership, reduced to what the cell renders and links to. */
interface UserTeam {
  id: string;
  name: string;
}

/**
 * The teams `expand: ["teams"]` embedded.
 *
 * Read defensively for the same reason `metadata` is: `teams` is absent when the
 * request did not ask for it and `[]` when the user is on none, and the rows
 * this walks are typed as an open record.
 *
 * Every membership the endpoint returns is kept, `pending` ones included — it
 * omits the ones the user was removed from, so what arrives is the roster. An
 * entry missing either half is dropped: a name with no id cannot be linked, and
 * an id with no name has nothing to render.
 */
function userTeams(user: Record<string, unknown>): UserTeam[] {
  if (!Array.isArray(user.teams)) return [];
  return user.teams
    .map((team) => {
      if (!team || typeof team !== "object") return undefined;
      const record = team as Record<string, unknown>;
      const id = field(record, "id");
      const name = field(record, "name");
      return id && name ? { id, name } : undefined;
    })
    .filter(isPresent);
}

/**
 * `metadata.status` — one of `active`, `suspended`, `deactivated`,
 * `pending_purge`. Read defensively: `metadata` is a server-owned object on an
 * otherwise open record, so a user written before it existed simply has none.
 */
function userStatus(user: Record<string, unknown>): string | undefined {
  const metadata = user.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  return field(metadata as Record<string, unknown>, "status");
}


/**
 * The teams a user belongs to, glyphed the way the design draws the cell and the
 * way the Teams directory draws a team row.
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
 * The design's fuller menu is not buildable yet, and the entries were rendering
 * as live controls that did nothing:
 *
 *   - `Edit user` — no `PATCH`/`PUT /users/{user_id}` endpoint (#693)
 *   - `Deactivate` — no `status` field and no lifecycle endpoint (#553)
 *   - `Reset password` — `PUT /users/{user_id}/password` exists, but the screen
 *     that would collect the new password does not; the menu item alone had
 *     nothing behind it
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
            <MoreVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem asChild>
            <Link to="/users/$userId" params={{ userId }}>
              View details
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
