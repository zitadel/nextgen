import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Search } from "lucide-react";
import { useCallback, useState } from "react";

import { api } from "@/api/zitadel";
import { consoleSessionProject, validateNextSearch } from "@/auth/session";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
  RESOURCE_HEADER,
  RESOURCE_ROW_ICON,
  RESOURCE_ROW_LINK,
  RESOURCE_TABLE_FIXED,
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
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CliCommand, CliHint, cliSetup } from "@/components/cli-hint";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { useSearchDraft } from "@/hooks/use-search-draft";
import { formatDate } from "@/lib/date";
import { serverOrigin } from "@/lib/server-origin";
import { useMyProjects, useProjectScope, useSelectProjectTarget } from "@/lib/project-scope";
import { Page } from "@/components/layout";

/**
 * Projects overview — every project the person can act on.
 *
 * The sidebar's first entry, above the selected project's contents. It is not
 * scoped (`staticData.scope`), so it is listed with or without a selection and
 * is the one entry while nothing is selected. The top bar shows no project
 * switcher here: this list is where a project is chosen, and it marks the
 * selected one. It is where the console lands when there are several
 * projects and none is selected yet (`routes/_authed.tsx`). The
 * guard then passes the screen it was asked for as `?next=`, and a row goes
 * back there with the project selected.
 *
 * A row opens the project — selects it and goes to its first screen — rather
 * than a detail page: the project's own page is `Project settings` in the
 * sidebar once it is selected, and the row menu links there directly.
 *
 * Once the person's projects run past one page it carries a search, matched on
 * the server across every project they can act on (`name_contains`), never
 * against the rows already loaded: an account with many projects finds one by
 * name rather than by paging. A list that fits on one page needs none. "One
 * page" is the first page the project switcher reads (`useMyProjects`), so the
 * two offer a search to the same people.
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

/** Three equal columns; the trailing one carries the row menu. */
const COLUMN = "w-1/3";

function ProjectsScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = useProjectScope();
  const selectTarget = useSelectProjectTarget();
  const search = Route.useSearch();
  const onSearch = useCallback(
    (q: string) =>
      void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true }),
    [navigate],
  );
  // Latched for the screen's lifetime: a cleared search drops `?q=` before the
  // full list is back, and the field must not unmount in between.
  const mine = useMyProjects();
  const [searchable, setSearchable] = useState(false);
  if (!searchable && (mine?.more || search.q)) setSearchable(true);

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
  const projects = [...loaded.projects, ...paging.extra];

  return (
    <Page>
      <ResourceTitle>Projects</ResourceTitle>
      {/* Until a project is selected the sidebar lists only this screen, so the
          page says why and what to do about it. */}
      {!selected && projects.length > 0 && (
        <p className={`${RESOURCE_HEADER} text-muted-foreground mt-2 text-sm`}>
          Select a project to manage its teams, users and login flows.
        </p>
      )}
      {searchable && (
        <div className={`${RESOURCE_HEADER} ${RESOURCE_TABLE_TOP}`}>
          <ProjectSearch query={search.q ?? ""} onSearch={onSearch} />
        </div>
      )}

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        {/* Three equal columns, as the design lays them out; the trailing one
            carries the row menu. */}
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className={COLUMN}>Name</ResourceHeadCell>
              <ResourceHeadCell className={COLUMN}>Created</ResourceHeadCell>
              <ResourceMenuHead className={COLUMN} />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <ResourceEmptyRow colSpan={3}>
                {loaded.q ? `No projects match “${loaded.q}”.` : "No projects yet."}
              </ResourceEmptyRow>
            ) : (
              projects.map((project) => (
                // The whole row opens the project: selects it and lands on its
                // first screen, or on the screen `?next=` names — the same
                // target as the switcher's row. The name
                // is a real link so the row is reachable by keyboard and the
                // target shows in the status bar; the row handler is the pointer
                // affordance on top of it, and `opensRow` keeps it out of the
                // link's way.
                <ResourceRow
                  key={project.id}
                  aria-current={project.id === selected ? "true" : undefined}
                  onOpen={() => void navigate(selectTarget(project.id))}
                >
                  <TableCell className={`${RESOURCE_CELL} truncate`}>
                    <Link {...selectTarget(project.id)} className={RESOURCE_ROW_LINK}>
                      <Boxes aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className={RESOURCE_CELL_MUTED}>
                    {formatDate(project.created_at)}
                  </TableCell>
                  <TableCell className={`${RESOURCE_CELL} text-right`}>
                    <RowActions projectId={project.id} name={project.name} />
                  </TableCell>
                </ResourceRow>
              ))
            )}
          </TableBody>
        </Table>
        <CliHint>
          Create a project and connect your app with{" "}
          <CliCommand>{cliSetup(serverOrigin())}</CliCommand>.
        </CliHint>
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
