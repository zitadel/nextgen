import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Box, Boxes, Plus } from "lucide-react";

import { api } from "@/api/zitadel";
import { validateNextSearch } from "@/auth/session";
import { NewProjectDialog } from "@/components/new-project-dialog";
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
  ResourcePage,
  ResourceRow,
  ResourceTitle,
  RowMenu,
} from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table";
import { useLoadMore } from "@/hooks/use-load-more";
import { formatDate } from "@/lib/date";
import {
  type MyProject,
  listMyProjectsCached,
  useProjectScope,
  useSelectProjectTarget,
} from "@/lib/project-scope";
import { clearSessionCaches } from "@/lib/session-cache";
import { type ConsoleRegion, getRegions, isPlatformMode } from "@/runtime/runtime";

/**
 * Projects overview — every project the person can act on.
 *
 * The sidebar's first entry, above the selected project's contents. It is not
 * scoped (`staticData.scope`), so it is listed with or without a selection and
 * is the one entry while nothing is selected. The project switcher's `All
 * projects` link leads here too, and it is where the console lands when there
 * are several projects and none is selected yet (`routes/_authed.tsx`). The
 * guard then passes the screen it was asked for as `?next=`, and a row goes
 * back there with the project selected.
 *
 * A row opens the project — selects it and goes to its first screen — rather
 * than a detail page: the project's own page is `Project settings` in the
 * sidebar once it is selected, and the row menu links there directly.
 *
 * In platform mode (Console ADR 0004 §6) the projects live in the regions, so
 * the list is every region's first page with the region beside each row, and
 * the screen's action creates a project in a chosen region.
 */
export const Route = createFileRoute("/_authed/projects/")({
  // Order 1: above Teams (2), the first of the selected project's screens.
  staticData: { nav: { label: "Projects", order: 1, icon: Boxes } },
  // Sanitized like the login screen's: only a router-relative path is followed.
  validateSearch: validateNextSearch,
  loader: async (): Promise<{
    projects: MyProject[];
    nextPageToken: string | undefined;
    unreachable: ConsoleRegion[];
  }> => {
    if (isPlatformMode()) {
      const { projects, unreachable } = await listMyProjectsCached();
      return { projects, nextPageToken: undefined, unreachable };
    }
    // The projects the signed-in person can act on (root ADR 053 §6), read with
    // the session cookie — not `POST /projects/query`, which the server pins to
    // the calling credential's one home project (#1237).
    const page = await api.listMyProjects({ limit: PAGE_SIZE });
    return {
      projects: page.projects,
      nextPageToken: page.next_page_token ?? undefined,
      unreachable: [],
    };
  },
  component: ProjectsScreen,
});

/**
 * One page of projects. `GET /users/me/projects` is cursor-paginated, so this is a
 * page size rather than a cap on what the operator can reach — `Load more` walks
 * the rest (design decisions log D5: a button, not pagination controls).
 */
const PAGE_SIZE = 25;

function ProjectsScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const selected = useProjectScope();
  const selectTarget = useSelectProjectTarget();
  const platform = isPlatformMode();
  const regions = getRegions();
  // Equal columns; the trailing one carries the row menu. Platform mode adds
  // the region.
  const column = platform ? "w-1/4" : "w-1/3";

  const paging = useLoadMore(
    loaded,
    async (pageToken) => {
      const page = await api.listMyProjects({ limit: PAGE_SIZE, page_token: pageToken });
      return { items: page.projects, nextPageToken: page.next_page_token ?? undefined };
    },
    "Could not load more projects.",
  );
  const projects: MyProject[] = [...loaded.projects, ...paging.extra];

  return (
    <ResourcePage>
      <ResourceTitle
        action={
          platform && regions.length > 0 ? (
            <NewProjectDialog
              regions={regions}
              onCreated={() => {
                // The cached fan-out is what this screen and the switcher
                // show; drop it so the new project is listed.
                clearSessionCaches();
                void router.invalidate();
              }}
            >
              <Button className="shrink-0 gap-1.5 px-2.5!">
                <Plus aria-hidden />
                New project
              </Button>
            </NewProjectDialog>
          ) : undefined
        }
      >
        Projects
      </ResourceTitle>
      {loaded.unreachable.length > 0 && (
        <p className={`${RESOURCE_HEADER} text-destructive mt-2 text-sm`}>
          Could not list the projects in{" "}
          {loaded.unreachable.map((region) => region.name).join(", ")}.
        </p>
      )}
      {/* Until a project is selected the sidebar lists only this screen, so the
          page says why and what to do about it. */}
      {!selected && projects.length > 0 && (
        <p className={`${RESOURCE_HEADER} text-muted-foreground mt-2 text-sm`}>
          Select a project to manage its teams, users and login flows.
        </p>
      )}

      <div className={`${RESOURCE_TABLE_WRAP} ${RESOURCE_TABLE_TOP}`}>
        {/* Three equal columns, as the design lays them out; the trailing one
            carries the row menu. */}
        <Table className={RESOURCE_TABLE_FIXED}>
          <TableHeader>
            <ResourceHeaderRow>
              <ResourceHeadCell className={column}>Name</ResourceHeadCell>
              {platform && <ResourceHeadCell className={column}>Region</ResourceHeadCell>}
              <ResourceHeadCell className={column}>Created</ResourceHeadCell>
              <ResourceMenuHead className={column} />
            </ResourceHeaderRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <ResourceEmptyRow colSpan={platform ? 4 : 3}>No projects yet.</ResourceEmptyRow>
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
                      <Box aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
                      {project.name}
                    </Link>
                  </TableCell>
                  {platform && (
                    <TableCell className={RESOURCE_CELL_MUTED}>
                      {project.region?.name ?? "—"}
                    </TableCell>
                  )}
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
      </div>

      <LoadMore paging={paging} />
    </ResourcePage>
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
