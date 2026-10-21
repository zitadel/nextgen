import {
  Link,
  type LinkProps,
  useMatch,
  useMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { Box, Boxes, Check, ChevronsUpDown, type LucideIcon, Plus, Slash } from "lucide-react";
import { useId, useState } from "react";

import { AddTeamSheet } from "@/components/add-team-sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "@/api/zitadel";
import { queryActiveTeams } from "@/lib/teams";
import { useAsync } from "@/hooks/use-async";
import {
  useMyProjects,
  useProjectScope,
  useSelectProjectTarget,
  withoutTrailingSlash,
} from "@/lib/project-scope";

/**
 * The top bar's context: the project switcher, then — on a team's page — a
 * slash and the team switcher, as the design's navbar draws them. Built on
 * shadcn `Popover`.
 *
 * The project popover has no footer: the sidebar's first entry is the
 * Projects overview. The team popover's footer adds a team, opening the Add
 * team drawer and then the new team.
 */

/**
 * What the project pill says once the read has answered with nothing. Also the
 * fallback for a failed read, so neither case leaves a skeleton behind.
 */
const NO_PROJECTS = "No projects";

/** What the project pill says while projects exist but none is selected. */
const NO_SELECTION = "Select a project";

interface SwitcherOption {
  id: string;
  label: string;
  /**
   * Where following the row goes — for a project, the same screen re-scoped
   * to it (`?project=`). Without one the row is a plain label.
   */
  link?: Pick<LinkProps, "to" | "params" | "search">;
}

export function ContextSwitcher() {
  const projects = useProjects();
  // The pill shows the selected project (`?project=`, `src/lib/project-scope.ts`),
  // never `getConsoleProjectId()`: that is the project the console signs into —
  // the platform project on a platform deployment — which is not what anybody
  // means here unless it was selected.
  const selected = useProjectScope();
  const current = useSelectedOption(selected, projects);
  const teamId = useParams({ strict: false, select: (params) => params.teamId });

  return (
    <nav aria-label="Context" className="flex min-w-0 items-center gap-2">
      <Switcher
        icon={Boxes}
        heading="Projects"
        label={current?.label}
        currentId={current?.id}
        options={projects}
        emptyLabel={projects?.length === 0 ? NO_PROJECTS : NO_SELECTION}
        ariaLabel="Switch project"
      />
      {/* The team switcher joins the bar once a team is open — the team is the
          context then, and following another team from the list switches it.
          Teams are not a standing selection the way projects are: no screen
          other than the team's own reads one. */}
      {teamId && selected && (
        <>
          <Slash aria-hidden className="size-3.5 shrink-0 -rotate-[20deg] text-border" />
          {/* Keyed: another project's teams must not show while this one's load. */}
          <TeamSwitcher key={selected} projectId={selected} teamId={teamId} />
        </>
      )}
    </nav>
  );
}

/**
 * The open team and the project's active teams, each a link to its own page —
 * so choosing one is a navigation, like choosing a project. One page of teams:
 * the list is a way across; the sidebar's Teams is the directory. Its footer
 * adds a team. The drawer lives outside the popover, which unmounts on close,
 * and opens the new team once it is created.
 */
function TeamSwitcher({ projectId, teamId }: { projectId: string; teamId: string }) {
  // The open team as its page loaded it. The page's loader re-runs after a
  // rename (`router.invalidate()`), so the label follows, and the list is
  // re-read with it.
  const openTeam = useMatch({ from: "/_authed/teams/$teamId", shouldThrow: false });
  const teams = useAsync(
    () => queryActiveTeams(projectId, { limit: TEAM_PAGE }),
    [],
    [projectId, openTeam?.updatedAt],
  );
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <Switcher
        icon={Box}
        heading="Teams"
        label={openTeam?.loaderData?.team.name}
        currentId={teamId}
        options={teams?.map((team) => ({
          id: team.id,
          label: team.name,
          link: { to: "/teams/$teamId", params: { teamId: team.id } },
        }))}
        emptyLabel="No teams"
        ariaLabel="Switch team"
        footer={{ label: "Add team", icon: Plus, onSelect: () => setAdding(true) }}
        current
      />
      <AddTeamSheet
        open={adding}
        onOpenChange={setAdding}
        onCreated={(team) => navigate({ to: "/teams/$teamId", params: { teamId: team.id } })}
      />
    </>
  );
}

/** One page of the team switcher's list. */
const TEAM_PAGE = 25;

/** The project pill's options: the person's projects (`useMyProjects`), each a link re-scoping to it. */
function useProjects(): SwitcherOption[] | undefined {
  const projects = useMyProjects();
  const scopeTo = useScopeTarget();
  return projects?.map(({ id, name }) => ({ id, label: name, link: scopeTo(id) }));
}

/**
 * Where selecting a project goes. A project-scoped list stays where it is and
 * re-reads under the new project, keeping its own filters (Teams' tab and
 * search). Anything else — a detail page, whose resource belongs to the
 * previous project, or an unscoped screen such as Projects — goes where a
 * Projects row would (`useSelectProjectTarget`): the screen `?next=` names, or
 * the console's landing for that project.
 */
function useScopeTarget(): (projectId: string) => NonNullable<SwitcherOption["link"]> {
  const leaf = useMatches({ select: (matches) => matches[matches.length - 1] });
  const selectTarget = useSelectProjectTarget();
  const stays = leaf?.staticData.scope === "project" && leaf.staticData.nav !== undefined;
  return (projectId) =>
    stays && leaf
      ? {
          to: withoutTrailingSlash(leaf.fullPath),
          search: (prev: Record<string, unknown>) => ({ ...prev, project: projectId }),
        }
      : selectTarget(projectId);
}

/**
 * The option the pill shows. A selected project missing from the list — one
 * named by a shared link's `?project=` rather than chosen here — is named by
 * `GET /projects/{id}`, and by its id until that read answers or if it is
 * refused.
 */
function useSelectedOption(
  selected: string | undefined,
  projects: SwitcherOption[] | undefined,
): SwitcherOption | undefined {
  const listed = selected ? projects?.find((project) => project.id === selected) : undefined;
  const missing = selected !== undefined && projects !== undefined && listed === undefined;
  // Tagged with the id it answers for: a re-read keeps the last answer until
  // the next lands, and that must not name another project.
  const read = useAsync(
    missing && selected
      ? () => api.getProject(selected).then((project) => ({ id: selected, name: project.name }))
      : null,
    undefined,
    [missing, selected],
  );

  if (listed) return listed;
  if (!missing) return undefined;
  return { id: selected, label: read?.id === selected ? read.name : selected };
}

function Switcher({
  icon: Icon,
  heading,
  label,
  currentId,
  options,
  emptyLabel,
  ariaLabel,
  footer,
  current = false,
}: {
  icon: LucideIcon;
  /** The list's caption, as the design's menu label draws it (`PROJECTS`). */
  heading: string;
  /** `undefined` while loading, and when there are no options to name. */
  label: string | undefined;
  /** The option the pill is showing, marked `aria-current` in the list. */
  currentId?: string;
  /** `undefined` while options are loading. */
  options: SwitcherOption[] | undefined;
  /** Shown in place of a label once the options have loaded and there are none. */
  emptyLabel: string;
  ariaLabel: string;
  /** An action beneath the options, which closes the popover first. */
  footer?: { label: string; icon: LucideIcon; onSelect: () => void };
  /** The innermost context in the bar, whose label the design sets semibold. */
  current?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  // Loading is the options not having answered yet — not the label being
  // absent, which is also what an empty answer looks like.
  const loading = options === undefined;

  const rows = options ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} className={TRIGGER}>
          <Icon size={16} className="shrink-0 text-foreground" aria-hidden />
          {loading ? (
            <Skeleton className="h-4 w-24" />
          ) : label === undefined ? (
            <span className="min-w-0 truncate text-muted-foreground">{emptyLabel}</span>
          ) : (
            <span
              className={cn(
                "min-w-0 truncate text-foreground",
                current ? "leading-none font-semibold" : "leading-5",
              )}
            >
              {label}
            </span>
          )}
          <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-60 border-border bg-popover p-1 text-popover-foreground"
      >
        <p className="px-2 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {heading}
        </p>
        <ul id={listId} aria-label={ariaLabel} className="flex flex-col">
          {rows.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</li>
          ) : (
            // Links, not buttons: selecting a project or a team is a navigation —
            // the project lives in the URL (`?project=`), the team is the page.
            rows.map((option) => {
              const selected = option.id === currentId;
              const content = (
                <>
                  <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm text-foreground">{option.label}</span>
                  {selected && <Check size={16} className="shrink-0 text-foreground" aria-hidden />}
                </>
              );
              return (
                <li
                  key={option.id}
                  // By id, not by label: two projects may share a name.
                  aria-current={selected ? "true" : undefined}
                >
                  {option.link ? (
                    <Link
                      {...option.link}
                      onClick={() => setOpen(false)}
                      // The ring is the buttons' (`ui/button.tsx`): the background
                      // alone is also the hover state, so it cannot be what tells
                      // a keyboard user where focus is.
                      className={cn(
                        ROW,
                        "outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      )}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={ROW}>{content}</div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {footer && (
          // `foreground/10`, as the account menu's hairlines: `border` is the
          // popover's own colour on the dark theme and would not show.
          <div className="-mx-1 mt-1 border-t border-foreground/10 px-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                footer.onSelect();
              }}
              // Laid out like a row (`ROW`): icon, then the label in line with
              // the names above.
              className={cn(
                ROW,
                "w-full text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              <footer.icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate text-sm text-foreground">{footer.label}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The bar's switcher: a borderless 32px button — glyph, name, chevrons — that
 * fills only on hover or while open. Height, padding, radius and the hover fill
 * are the sidebar rows' (`SidebarMenuButton`), so the bar and the sidebar read
 * as one set of controls rather than two contrasts. Capped so a long name
 * truncates rather than pushing search off the bar.
 */
const TRIGGER =
  "flex h-8 max-w-64 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent";

/** A list row: 32px, glyph, name, and a check on the current one. */
const ROW = "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left";
