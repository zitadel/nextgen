import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Box, Boxes, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

export const Route = createFileRoute("/_authed/projects/")({
  staticData: { nav: { label: "Projects", order: 1, icon: Boxes } },
  loader: async () => {
    const page = await api.queryProjects({ limit: PAGE_SIZE });
    return { projects: page.projects, nextPageToken: page.next_page_token ?? undefined };
  },
  component: ProjectsScreen,
});

/**
 * One page of projects. `POST /projects/query` is cursor-paginated, so this is a
 * page size rather than a cap on what the operator can reach — `Load more` walks
 * the rest (design decisions log D5: a button, not pagination controls).
 */
const PAGE_SIZE = 25;

/** Three equal columns; the trailing one holds the place the design reserves for the row menu. */
const COLUMN = "w-1/3";

type Project = Awaited<ReturnType<typeof api.queryProjects>>["projects"][number];

function ProjectsScreen() {
  const loaded = Route.useLoaderData();
  const navigate = useNavigate();

  // Pages fetched after the first live here rather than in the loader, so `Load
  // more` appends without re-running it and a route invalidation resets to the
  // first page — the honest thing to show once the set has changed underneath.
  const [extra, setExtra] = useState<Project[]>([]);
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

  const projects = [...loaded.projects, ...extra];

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    const generation = loaded;
    setLoadingMore(true);
    try {
      const page = await api.queryProjects({ limit: PAGE_SIZE, page_token: nextPageToken });
      // A page that lands after the list was invalidated answers a question about
      // the previous set; appending it would re-add rows the server may no longer
      // return. It is dropped, leaving the button ready to fetch the current
      // page 2.
      if (loadedRef.current !== generation) return;
      setExtra((current) => [...current, ...page.projects]);
      setNextPageToken(page.next_page_token ?? undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div className={`${RESOURCE_HEADER} flex h-9 items-center`}>
        <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">Projects</h1>
      </div>

      <div className={`${RESOURCE_TABLE_WRAP} mt-5`}>
        {/* Three equal columns, as the design lays them out. The trailing one is
            the column the design reserves for the row menu: the menu itself is
            not built, but the grid keeps its place so `Created` lands where the
            design puts it. */}
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow className="border-border border-b hover:bg-transparent">
              <ResourceHeadCell className={COLUMN}>Name</ResourceHeadCell>
              <ResourceHeadCell className={COLUMN}>Created</ResourceHeadCell>
              <TableHead className={`${COLUMN} h-14 px-6`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell colSpan={3} className="text-muted-foreground h-24 text-center">
                  No projects yet.
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => (
                // The whole row opens the project. The name is a real link so the
                // row is reachable by keyboard and the target shows in the status
                // bar; the row handler is the pointer affordance on top of it,
                // and `opensRow` keeps it out of the link's way.
                <TableRow
                  key={project.id}
                  className="hover:bg-muted/40 cursor-pointer border-0"
                  onClick={(event) => {
                    if (opensRow(event)) {
                      void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
                    }
                  }}
                >
                  <TableCell className={`${RESOURCE_CELL} truncate`}>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      className={RESOURCE_ROW_LINK}
                    >
                      <Box aria-hidden strokeWidth={1.5} className={RESOURCE_ROW_ICON} />
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className={`${RESOURCE_CELL} text-muted-foreground truncate text-sm`}>
                    {formatDate(project.created_at)}
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

