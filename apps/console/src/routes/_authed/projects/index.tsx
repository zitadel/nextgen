import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Plus, Search } from "lucide-react";
import { useCallback, useState } from "react";

import { api } from "@/api/zitadel";
import { consoleSessionProject, validateNextSearch } from "@/auth/session";
import { useNavItems, useRequestedNavItem } from "@/components/app-shell/use-nav-items";
import { NewProjectSheet } from "@/components/new-project-sheet";
import { ProjectMark } from "@/components/project-mark";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_HEADER,
  RESOURCE_TABLE_TOP,
  RESOURCE_TABLE_WRAP,
  ResourceEmptyRow,
  ResourceHeadCell,
  ResourceHeaderRow,
  ResourceIdCell,
  ResourceMenuHead,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { useSearchDraft } from "@/hooks/use-search-draft";
import { formatDate } from "@/lib/date";
import { byName, primaryHost, useProjectScope, useSelectProjectTarget } from "@/lib/project-scope";
import { Page } from "@/components/layout";

/**
 * Projects overview — every project the person can act on.
 *
 * The sidebar's first entry, above the project's screens. It is where the
 * console lands when there are several projects and none is selected yet
 * (`routes/_authed/index.tsx`), and where the `_authed` guard sends a screen
 * that needs a project while none is selected, passing it as `?next=`. The
 * page is then the way to that screen — `Continue to Teams`, with Teams marked
 * in the sidebar (D22) — and a row goes on there with the project selected.
 *
 * A row opens the project — selects it and goes to its first screen — rather
 * than a detail page: the project's own page is `Project settings` in the
 * sidebar once it is selected, and the row menu links there directly.
 *
 * The list can hold every project of a deployment — a platform operator acts
 * on all of them — so a row tells projects apart the way the project switcher
 * does (D21): the project's generated mark, its name with its site's host
 * beneath, and its ID. Complete on its first page, the list reads by name;
 * a longer one keeps the server's order, by id, so `Load more` appends to the
 * rows shown rather than reshuffling them. The search is matched on the server
 * across every project the person can act on (`name_contains`), never against
 * the rows already loaded.
 */
export const Route = createFileRoute("/_authed/projects/")({
  // Order 1: above Teams (2), the first of the selected project's screens.
  staticData: { nav: { label: "Projects", order: 1, icon: Boxes } },
  // `next` is sanitized like the login screen's: only a router-relative path
  // is followed. The search lives in the URL like a filter tab: it belongs to
  // the request the loader makes, so a searched list survives a reload, and
  // changing it re-runs the loader, which resets the paged-in rows.
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => ({
    ...validateNextSearch(search),
    q: typeof search.q === "string" && search.q.trim() !== "" ? search.q.trim() : undefined,
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    // The projects the signed-in person can act on (root ADR 053 §6), read with
    // the session cookie — not `POST /projects/query`, which the server pins to
    // the calling credential's one home project (#1237).
    const page = await api.listMyProjects({
      limit: PAGE_SIZE,
      name_contains: deps.q,
      ...consoleSessionProject(),
    });
    return { projects: page.projects, nextPageToken: page.next_page_token ?? undefined, q: deps.q };
  },
  component: ProjectsScreen,
});

type ProjectsSearch = { next?: string; q?: string };

/**
 * One page of projects. `GET /users/me/projects` is cursor-paginated, so this is a
 * page size rather than a cap on what the operator can reach — `Load more` walks
 * the rest (design decisions log D5: a button, not pagination controls).
 */
const PAGE_SIZE = 25;

/** The Name cell clamps at 280px and truncates, as the Users table's User cell does. */
const NAME_CLAMP = "max-w-70";

function ProjectsScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = useProjectScope();
  const selectTarget = useSelectProjectTarget();
  // Opened on the way to a screen that needs a project (`?next=`), the page
  // names that screen, as the sidebar marks it (D22).
  const requested = useRequestedNavItem(useNavItems());
  const search = Route.useSearch();
  const onSearch = useCallback(
    (q: string) =>
      void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true }),
    [navigate],
  );

  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      const page = await api.listMyProjects({
        limit: PAGE_SIZE,
        page_token: pageToken,
        // The search the token was issued under: a page token answers one
        // question, and asking another with it is not a narrower list but a
        // meaningless one.
        name_contains: loaded.q,
        ...consoleSessionProject(),
      });
      return { items: page.projects, nextPageToken: page.next_page_token ?? undefined };
    },
    "Could not load more projects.",
  );
  // A page with no token after it is the whole list, so it can read by name;
  // the server's order is by id, which reads as no order at all.
  const projects = loaded.nextPageToken
    ? [...loaded.projects, ...paging.extra]
    : byName(loaded.projects);

  // Latched for the screen's lifetime: a cleared search drops `?q=` before the
  // full list is back, and the field must not unmount in between. A person
  // with no projects has nothing to search.
  const [searchable, setSearchable] = useState(false);
  if (!searchable && (projects.length > 0 || search.q)) setSearchable(true);

  return (
    <Page>
      <ResourceTitle
        action={
          <NewProjectSheet>
            {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
                `px-2.5`, as on the Users title. */}
            <Button className="shrink-0 gap-1.5 px-2.5!">
              <Plus aria-hidden />
              New project
            </Button>
          </NewProjectSheet>
        }
      >
        {requested ? `Continue to ${requested.nav.label}` : "Projects"}
      </ResourceTitle>
      {/* Until a project is selected the project's screens ask for one first,
          so the page says what choosing one is for, or, on the way to one of
          them, that choosing goes on there. */}
      {projects.length > 0 && (requested || !selected) && (
        <p className={`${RESOURCE_HEADER} text-muted-foreground mt-2 text-sm`}>
          {requested
            ? "Choose a project to continue."
            : "Select a project to manage its teams, users and login flows."}
        </p>
      )}
      {searchable && (
        <div className={`${RESOURCE_HEADER} ${RESOURCE_TABLE_TOP}`}>
          <ProjectSearch query={search.q ?? ""} onSearch={onSearch} />
        </div>
      )}

      {/* As the Users table: the Name cell clamps, the ID takes the slack and
          truncates first, and the date and row menu keep their own width. */}
      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        <Table className="text-xs">
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell>Name</ResourceHeadCell>
              <ResourceHeadCell>ID</ResourceHeadCell>
              <ResourceHeadCell>Created</ResourceHeadCell>
              <ResourceMenuHead className="w-15" />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <ResourceEmptyRow colSpan={4}>
                {loaded.q ? `No projects match “${loaded.q}”.` : "No projects yet."}
              </ResourceEmptyRow>
            ) : (
              projects.map((project) => {
                const host = primaryHost(project.origins);
                return (
                  // The whole row opens the project: selects it and lands on its
                  // first screen, or on the screen `?next=` names — the same
                  // target as the switcher's row. The name is a real link so the
                  // row is reachable by keyboard and the target shows in the
                  // status bar; the row handler is the pointer affordance on top
                  // of it, and `opensRow` keeps it out of the link's way.
                  <ResourceRow
                    key={project.id}
                    className="group"
                    aria-current={project.id === selected ? "true" : undefined}
                    onOpen={() => void navigate(selectTarget(project.id))}
                  >
                    {/* The mark and the host are the project switcher's: what
                        tells two projects of one name apart (D20's pattern of
                        a second line under the name). */}
                    <TableCell className={`${RESOURCE_CELL} ${NAME_CLAMP} text-sm`}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ProjectMark projectId={project.id} className="size-6" />
                        <span className="min-w-0">
                          <Link
                            {...selectTarget(project.id)}
                            className="text-foreground block truncate font-medium underline-offset-2 hover:underline"
                          >
                            {project.name}
                          </Link>
                          {host && (
                            <span className="text-muted-foreground block truncate text-xs">
                              {host}
                            </span>
                          )}
                        </span>
                      </span>
                    </TableCell>
                    <ResourceIdCell id={project.id} name={project.name} />
                    <TableCell className={RESOURCE_CELL_MUTED}>
                      {formatDate(project.created_at)}
                    </TableCell>
                    <TableCell className={`${RESOURCE_CELL} text-right`}>
                      <RowActions projectId={project.id} name={project.name} />
                    </TableCell>
                  </ResourceRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <LoadMore paging={paging} />
    </Page>
  );
}

/**
 * The list's search field. A pause in typing settles the term into the URL
 * (`?q=`), whose loader sends it to the server (`useSearchDraft`).
 */
function ProjectSearch({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useSearchDraft(query, onSearch);

  return (
    <div className="relative w-full max-w-90">
      <Search
        aria-hidden
        strokeWidth={1.5}
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search projects"
        aria-label="Search projects"
        className="pl-8"
      />
    </div>
  );
}

/**
 * The row menu.
 *
 * `Project settings` goes straight to the project's own page, which the row
 * itself does not: the row opens the project's contents. There is no project
 * delete endpoint, so there is no destructive action here.
 */
function RowActions({ projectId, name }: { projectId: string; name: string }) {
  return (
    <RowMenu name={name}>
      <DropdownMenuItem asChild>
        <Link to="/project" search={{ project: projectId }}>
          Project settings
        </Link>
      </DropdownMenuItem>
    </RowMenu>
  );
}
