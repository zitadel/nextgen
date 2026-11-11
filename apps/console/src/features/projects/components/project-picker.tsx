import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { ProjectMark } from "@/components/project-mark";
import { LoadMore } from "@/components/resource-list";
import { SearchField } from "@/components/search-field";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { LoadMoreState } from "@/hooks/use-load-more";
import type { NavIcon } from "@/nav";

import { type ProjectRead, primaryHost } from "../model";
import { useSelectProjectTarget } from "../project-scope";
import { NewProjectSheet } from "./new-project-sheet";

/**
 * The step before a screen that needs a project while none is selected (D31):
 * the screen's own icon and name, one sentence, and the person's projects to
 * choose from. Choosing one goes on to that screen with the project selected.
 *
 * It asks one thing, so it carries only what answers it. A project reads as
 * the project switcher draws it: its mark, its name, and beneath it what
 * tells it from another of the same name, its site's host or else its ID
 * (D21). Its created date and its row menu stay on Projects, the list this
 * is not.
 *
 * The list is the Projects page's own read: the newest page first, the search
 * matched on the server across every project, and `Load more` for the rest,
 * since a platform operator can choose from every project of a deployment.
 * `New project` ends it, for the person whose project is not made yet.
 */
export function ProjectPicker({
  label,
  icon: Icon,
  projects,
  query,
  searched,
  onSearch,
  paging,
}: {
  /** The screen the person asked for, as its sidebar entry names it. */
  label: string;
  /** That entry's glyph. */
  icon: NavIcon;
  projects: ReadonlyArray<ProjectRead>;
  /** The search as the URL holds it. */
  query: string;
  /** The search `projects` answers, which trails `query` while a read is on its way. */
  searched?: string;
  onSearch: (q: string) => void;
  paging: LoadMoreState;
}) {
  const selectTarget = useSelectProjectTarget();

  return (
    // The block starts under the top bar rather than centred in the window:
    // its list runs to a page of projects, and a centred block would move as
    // a search narrows it.
    <Empty className="py-10 md:py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {/* The design's glyphs are drawn at stroke 1.5 (`docs/styling.md`). */}
          <Icon aria-hidden className="stroke-[1.5]" />
        </EmptyMedia>
        <EmptyTitle asChild>
          <h1>Continue to {label}</h1>
        </EmptyTitle>
        <EmptyDescription>Choose a project to continue.</EmptyDescription>
      </EmptyHeader>

      <EmptyContent className="items-stretch gap-3 text-left text-wrap">
        <SearchField label="Search projects" query={query} onSearch={onSearch} className="w-full" />

        {projects.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center">No projects match “{searched}”.</p>
        ) : (
          <ul aria-label="Projects" className="flex flex-col gap-0.5">
            {projects.map((project) => {
              // The local machine and a preview pattern name no host; the ID
              // always tells two projects apart.
              const beneath = primaryHost(project.origins) ?? project.id;
              return (
                // The name is the link, stretched over the row (`after:inset-0`),
                // so the whole row is the target while the link is still named
                // by the project alone. The focus ring is drawn on that
                // stretch, around the row.
                <li
                  key={project.id}
                  className="hover:bg-accent dark:hover:bg-accent/50 relative flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1.5"
                >
                  <ProjectMark projectId={project.id} className="size-6" />
                  <span className="min-w-0">
                    <Link
                      {...selectTarget(project.id)}
                      className="text-foreground block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
                    >
                      {project.name}
                    </Link>
                    <span className="text-muted-foreground block truncate text-xs">{beneath}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <LoadMore paging={paging} />

        <NewProjectSheet>
          {/* On the rows' grid: their 8px inset, and the plus centred in the
              24px column the marks take. `px-2!`: `Button`'s
              `has-[>svg]:px-3` out-specifies a plain `px-2`. */}
          <Button variant="ghost" className="justify-start gap-2.5 px-2!">
            <Plus aria-hidden className="mx-1" />
            New project
          </Button>
        </NewProjectSheet>
      </EmptyContent>
    </Empty>
  );
}
