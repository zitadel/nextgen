import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Boxes, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { validateNextSearch } from "@/auth/session";
import { useNavItems, useRequestedNavItem } from "@/app-shell/use-nav-items";
import { NewProjectCard } from "@/features/projects/components/new-project-card";
import { NewProjectSheet } from "@/features/projects/components/new-project-sheet";
import { ProjectLifecycle } from "@/features/projects/components/project-lifecycle";
import { ProjectPicker } from "@/features/projects/components/project-picker";
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
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import { primaryHost } from "@/features/projects/model";
import { useSelectProjectTarget } from "@/features/projects/project-scope";
import { Page } from "@/components/layout";
import { SearchField } from "@/components/search-field";
import { searchTerm } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { listProjectsPage } from "@/features/projects/my-projects";
import { FormError } from "@/components/form-error";
import { useSearchedLoad } from "@/hooks/use-searched-load";

/**
 * Projects overview — every project the person can act on.
 *
 * The console's home: the logo and the project switcher's `All projects` open
 * it, and it heads the account sidebar, the list of what sits above every
 * project (D27). It is where the console lands when there are several
 * projects and none is selected yet (`routes/_authed/index.tsx`), and where
 * the `_authed` guard sends a screen that needs a project while none is
 * selected, passing it as `?next=`. The page is then the way to that screen,
 * `Continue to Teams` (D22), and draws the choice alone rather than the list
 * (`ProjectPicker`, D31): the same projects, search and paging, and choosing
 * one goes on there with the project selected.
 *
 * Opened for itself it is a list screen like every other: the title row with
 * its search and its action, then the table. A project is created from the
 * app it connects, so
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
  // is followed. The search lives in the URL like a filter tab, so a searched
  // list survives a reload.
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => ({
    ...validateNextSearch(search),
    q: searchTerm(search.q),
  }),
  // As on Users, the term is no loader dep: a new term is not a new match, so
  // the field being typed in stays mounted, and the screen reads a term that
  // comes after the load itself (`useSearchedLoad`).
  // `location.search` is the URL's, which `validateSearch` has not been over.
  loader: ({ location }) => listProjectsPage(searchTerm((location.search as { q?: unknown }).q)),
  component: ProjectsScreen,
});

type ProjectsSearch = { next?: string; q?: string };

/** The Name cell clamps at 280px and truncates, as the Users table's User cell does. */
const NAME_CLAMP = "max-w-70";

function ProjectsScreen() {
  const fromRoute = Route.useLoaderData();
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

  const { loaded, searching, searchError } = useSearchedLoad(
    search.q,
    fromRoute,
    () => listProjectsPage(search.q),
    "Could not search the projects.",
  );

  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      // The search the token was issued under.
      const page = await listProjectsPage(loaded.q, pageToken);
      return { items: page.projects, nextPageToken: page.nextPageToken };
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

  // On the way to a screen that needs a project, the page is the choice of
  // one and nothing else (D31). With no project yet there is none to choose,
  // so the page below is the way to a first one, still named for the screen.
  if (requested && !none) {
    return (
      <Page>
        <FormError message={searchError} className="mb-3" />
        <ProjectPicker
          label={requested.nav.label}
          icon={requested.nav.icon}
          projects={projects}
          query={search.q ?? ""}
          searched={loaded.q}
          onSearch={onSearch}
          paging={paging}
        />
      </Page>
    );
  }

  return (
    <Page>
      <ResourceTitle
        filter={
          searchable && (
            <SearchField
              label="Search projects"
              query={search.q ?? ""}
              onSearch={onSearch}
              className="w-full sm:w-64"
            />
          )
        }
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
          <FormError message={searchError} className="mt-3" />
          {/* The rows of the last search stand, dimmed, until the next answers. */}
          <div
            aria-busy={searching || undefined}
            className={cn(RESOURCE_TABLE_WRAP, RESOURCE_TABLE_TOP, searching && "opacity-60")}
          >
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
