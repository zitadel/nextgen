import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Plus, Search } from "lucide-react";
import { useCallback, useState } from "react";

import { api } from "@/api/zitadel";
import { consoleSessionProject, validateNextSearch } from "@/auth/session";
import { useNavItems, useRequestedNavItem } from "@/app-shell/use-nav-items";
import { NewProjectCard } from "@/features/projects/components/new-project-card";
import { NewProjectSheet } from "@/features/projects/components/new-project-sheet";
import { ProjectLifecycle } from "@/features/projects/components/project-lifecycle";
import { ProjectMark } from "@/components/project-mark";
import {
  LoadMore,
  RESOURCE_CELL,
  RESOURCE_CELL_MUTED,
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
import { primaryHost } from "@/features/projects/model";
import { useSelectProjectTarget } from "@/features/projects/project-scope";
import { Page } from "@/components/layout";
import { LIST_PAGE_SIZE } from "@/lib/paging";

/**
 * Projects overview — every project the person can act on.
 *
 * The console's home: the logo and the project switcher's `All projects` open
 * it, and it heads the account sidebar, the list of what sits above every
 * project (D27). It is where the console lands when there are several
 * projects and none is selected yet (`routes/_authed/index.tsx`), and where
 * the `_authed` guard sends a screen that needs a project while none is
 * selected, passing it as `?next=`. The page is then the way to that screen —
 * `Continue to Teams` (D22) — and a row goes on there with the project
 * selected.
 *
 * It is a list screen like every other: the title row with its search and its
 * action, then the table. A project is created from the app it connects, so
 * `New project` opens a drawer with the CLI's `setup` command and how a
 * project goes from that command to production, not a form. With no project
 * yet there is nothing to list, so the page is that command and that guide
 * (`NewProjectCard`, `ProjectLifecycle`).
 *
 * A row opens the project — selects it and goes to its first screen — rather
 * than a detail page: the project's own page is `Settings` in the
 * sidebar once it is selected, and the row menu links there directly.
 *
 * The list can hold every project of a deployment — a platform operator acts
 * on all of them — so a row tells projects apart the way the project switcher
 * does (D21): the project's generated mark, its name with its site's host
 * beneath, and its ID. The list reads newest first at every length (D28): the
 * server sorts it by creation time (`order=desc`), so a project made a minute
 * ago heads the list instead of waiting behind `Load more`, which appends
 * older rows beneath the ones shown. The rows are never sorted here: a page
 * sorted among itself would put the next one out of place. The search is
 * matched on the server across every project the person can act on
 * (`name_contains`), never against the rows already loaded.
 */
export const Route = createFileRoute("/_authed/projects/")({
  // First in the account sidebar; no `scope`, since it is above every project.
  staticData: { nav: { label: "Projects", view: "account", order: 1, icon: Boxes } },
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
      limit: LIST_PAGE_SIZE,
      order: NEWEST_FIRST,
      name_contains: deps.q,
      ...consoleSessionProject(),
    });
    return { projects: page.projects, nextPageToken: page.next_page_token ?? undefined, q: deps.q };
  },
  component: ProjectsScreen,
});

type ProjectsSearch = { next?: string; q?: string };

/**
 * The list's order, by creation time rather than by id: an id says nothing
 * about when a project was made (root ADR 047). The loader and `Load more`
 * both send it, since a page token only continues the order it came from.
 */
const NEWEST_FIRST = "desc";

/** The Name cell clamps at 280px and truncates, as the Users table's User cell does. */
const NAME_CLAMP = "max-w-70";

function ProjectsScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const selectTarget = useSelectProjectTarget();
  // Opened on the way to a screen that needs a project (`?next=`), the page
  // names that screen (D22).
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
        limit: LIST_PAGE_SIZE,
        page_token: pageToken,
        // The order and the search the token was issued under: a page token
        // answers one question, and asking another with it is not a narrower
        // list but a meaningless one, or a refused one.
        order: NEWEST_FIRST,
        name_contains: loaded.q,
        ...consoleSessionProject(),
      });
      return { items: page.projects, nextPageToken: page.next_page_token ?? undefined };
    },
    "Could not load more projects.",
  );
  const projects = [...loaded.projects, ...paging.extra];

  // Latched for the screen's lifetime: a cleared search drops `?q=` before the
  // full list is back, and the field must not unmount in between. A person
  // with no projects has nothing to search.
  const [searchable, setSearchable] = useState(false);
  if (!searchable && (projects.length > 0 || search.q)) setSearchable(true);

  // Nothing to list and nothing searched for: the person has no project yet.
  const none = projects.length === 0 && !loaded.q;

  return (
    <Page>
      {/* On the way to a screen that needs a project, the title names it
          (D22): choosing a project goes on there. */}
      <ResourceTitle
        filter={searchable && <ProjectSearch query={search.q ?? ""} onSearch={onSearch} />}
        action={
          // The first project's command is the page itself, below.
          !none && (
            <NewProjectSheet>
              {/* `px-2.5!` — `Button`'s `has-[>svg]:px-3` out-specifies a plain
                  `px-2.5`. */}
              <Button className="shrink-0 gap-1.5 px-2.5!">
                <Plus aria-hidden />
                New project
              </Button>
            </NewProjectSheet>
          )
        }
      >
        {requested ? `Continue to ${requested.nav.label}` : "Projects"}
      </ResourceTitle>

      {none ? (
        <div className={`${RESOURCE_TABLE_TOP} flex flex-col gap-10`}>
          <div className="max-w-xl">
            <NewProjectCard />
          </div>
          <ProjectLifecycle className="border-t border-border pt-10" />
        </div>
      ) : (
        <>
          {/* As the Users table: the Name cell clamps, the ID takes the slack
              and truncates first, and the date and row menu keep their own
              width. */}
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
                  <ResourceEmptyRow colSpan={4}>No projects match “{loaded.q}”.</ResourceEmptyRow>
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
        </>
      )}
    </Page>
  );
}

/**
 * The list's search field, beside the title as a list's filter is (D25). A
 * pause in typing settles the term into the URL (`?q=`), whose loader sends it
 * to the server (`useSearchDraft`).
 */
function ProjectSearch({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useSearchDraft(query, onSearch);

  return (
    <div className="relative w-full sm:w-64">
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
 * `View project` goes straight to the project's own page, which the row
 * itself does not: the row opens the project's contents. There is no project
 * delete endpoint, so there is no destructive action here.
 */
function RowActions({ projectId, name }: { projectId: string; name: string }) {
  return (
    <RowMenu name={name}>
      <DropdownMenuItem asChild>
        <Link to="/project" search={{ project: projectId }}>
          View project
        </Link>
      </DropdownMenuItem>
    </RowMenu>
  );
}
