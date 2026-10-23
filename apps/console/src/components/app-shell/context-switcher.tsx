import {
  Link,
  type LinkProps,
  useMatch,
  useMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { Box, Boxes, Check, ChevronsUpDown, type LucideIcon, Plus, Slash } from "lucide-react";
import { useMemo, useState } from "react";

import { AddTeamSheet } from "@/components/add-team-sheet";
import { ProjectMark } from "@/components/project-mark";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  type ComboboxGroup,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { queryActiveTeams } from "@/lib/teams";
import { useAsync } from "@/hooks/use-async";
import {
  byName,
  type ProjectRef,
  type SelectedProject,
  useMyProjects,
  useProjectScope,
  useProjectSearch,
  useSelectedProject,
  useSelectProjectTarget,
  withoutTrailingSlash,
} from "@/lib/project-scope";
import {
  RECENT_PROJECT_LIMIT,
  readRecentProjects,
  useRememberRecentProject,
} from "@/lib/recent-projects";

/**
 * The top bar's context: the project switcher, then — on a team's page — a
 * slash and the team switcher, as the design's navbar draws them.
 *
 * The project switcher is the design system's searchable picker (`Combobox`):
 * it opens on a search field, matched on the server across every project the
 * person can act on, above the selected project and the ones they opened
 * recently, and, while all their projects fit on one page, every other one by
 * name. Its footer opens Projects. The team switcher is a `Popover` over the
 * project's active teams; its footer adds a team, opening the Add team drawer
 * and then the new team.
 */

/**
 * What the project pill says once the read has answered with nothing. Also the
 * fallback for a failed read, so neither case leaves a skeleton behind.
 */
const NO_PROJECTS = "No projects";

/** What the project pill says while projects exist but none is selected. */
const NO_SELECTION = "Select a project";

/** The project list's search field, label and placeholder alike. */
const FIND_PROJECT = "Find a project";

/** What the project list says when a search finds nothing. */
const NO_MATCHES = "No matching projects";

/** What it says while the search for what was typed is on its way. */
const SEARCHING = "Searching…";

/** What it says with nothing to open on: too many projects to list, none recent. */
const TYPE_TO_FIND = "Type to find a project";

/** What it says while the first page loads. */
const LOADING = "Loading projects…";

/** How many projects a search lists: as many as the first page. */
const PROJECT_RESULTS = 20;

interface SwitcherOption {
  id: string;
  label: string;
  /** Where following the row goes — for a team, its page. */
  link: Pick<LinkProps, "to" | "params" | "search">;
}

export function ContextSwitcher({ userId }: { userId?: string }) {
  // The pill shows the selected project (`?project=`, `src/lib/project-scope.ts`),
  // never `getConsoleProjectId()`: that is the project the console signs into —
  // the platform project on a platform deployment — which is not what anybody
  // means here unless it was selected. Never named from a search's matches,
  // which come and go as the person types; by its id until its name is read.
  // Read here, once, for the pill and for the person's recent projects: a
  // project selected anywhere — the switcher, Projects, search, a link — is the
  // one they opened last.
  const current = useSelectedProject();
  useRememberRecentProject(userId, current);
  const selected = useProjectScope();
  const teamId = useParams({ strict: false, select: (params) => params.teamId });

  return (
    <nav aria-label="Context" className="flex min-w-0 items-center gap-2">
      {/* On every screen, Projects included: the bar keeps its shape and
          names the selected project wherever the person is (D21). */}
      <ProjectSwitcher userId={userId} current={current} />
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
 * The project pill and its list. Choosing a project is a navigation, as a link
 * would be: the selection lives in the URL. Past the first page the list opens
 * on no more than the selected and recent projects, since that page is only the
 * oldest ones; the search reaches the rest.
 */
function ProjectSwitcher({
  userId,
  current,
}: {
  userId: string | undefined;
  /** The selected project, named once it is read. */
  current: SelectedProject | undefined;
}) {
  // The first page says whether there are more projects than it shows, and so
  // whether the list can open on all of them.
  const mine = useMyProjects();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const found = useProjectSearch(query, PROJECT_RESULTS);
  const navigate = useNavigate();
  const scopeTo = useScopeTarget();
  const selected = useProjectScope();
  // Read as the list opens, so it holds what was opened since it last did.
  const recents = useMemo(() => (open ? readRecentProjects(userId) : []), [open, userId]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    // A search starts over each time the list opens.
    if (!next) setQuery("");
  };

  const term = query.trim().toLowerCase();
  let groups: ComboboxGroup[] = [];
  let emptyLabel = LOADING;
  if (term) {
    // Re-filtered against the live query: until the next debounced read lands,
    // the last one's answer can name projects the typing has already ruled out.
    const matches = (found?.projects ?? []).filter((project) =>
      project.name.toLowerCase().includes(term),
    );
    groups = [{ options: byName(matches).map(toOption) }];
    emptyLabel = found?.term.toLowerCase() === term ? NO_MATCHES : SEARCHING;
  } else if (mine) {
    const named = current?.name === undefined ? undefined : { ...current, name: current.name };
    const { recent, rest } = openingList(mine, named, recents);
    groups = [
      { heading: "Recent", options: recent.map(toOption) },
      { heading: "Projects", options: rest.map(toOption) },
    ];
    emptyLabel = mine.projects.length === 0 && !mine.more ? NO_PROJECTS : TYPE_TO_FIND;
  }

  const label = current && (current.name ?? current.id);

  return (
    <Combobox open={open} onOpenChange={changeOpen}>
      <ComboboxAnchor asChild>
        <button type="button" aria-label="Switch project" className={TRIGGER}>
          {selected ? (
            <ProjectMark projectId={selected} className="size-4" />
          ) : (
            <Boxes size={16} className="shrink-0 text-foreground" aria-hidden />
          )}
          {mine === undefined ? (
            <Skeleton className="h-4 w-24" />
          ) : label === undefined ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {mine.projects.length === 0 ? NO_PROJECTS : NO_SELECTION}
            </span>
          ) : (
            <span className="min-w-0 truncate leading-5 text-foreground">{label}</span>
          )}
          <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </ComboboxAnchor>
      <ComboboxContent
        groups={groups}
        selected={selected ? [selected] : []}
        searchPlaceholder={FIND_PROJECT}
        emptyLabel={emptyLabel}
        search={{ query, onQueryChange: setQuery }}
        footer={{
          label: "All projects",
          icon: <Boxes aria-hidden />,
          onSelect: () => void navigate({ to: "/projects" }),
        }}
        label="Projects"
        // Wider than the pill: a row carries a name and its host or id.
        className="w-72"
        onSelect={(projectId) => void navigate(scopeTo(projectId))}
        onClose={() => changeOpen(false)}
      />
    </Combobox>
  );
}

/**
 * A project as the list shows it: its mark, its name, and beneath it what
 * tells it from another of the same name — its site's host, or else its id.
 */
function toOption(project: ProjectRef): ComboboxOption {
  return {
    value: project.id,
    label: project.name,
    description: project.host ?? project.id,
    icon: <ProjectMark projectId={project.id} />,
  };
}

/**
 * What the list opens on before anything is typed: the selected project, then
 * the recent ones, then, while the first page holds all of the person's
 * projects, the rest by name. A recent project that full list lacks is gone,
 * or no longer theirs; past one page that cannot be told, so recent ones stand
 * as they were kept.
 */
function openingList(
  mine: { projects: ProjectRef[]; more: boolean },
  current: ProjectRef | undefined,
  recents: ProjectRef[],
): { recent: ProjectRef[]; rest: ProjectRef[] } {
  const listed = new Map(mine.projects.map((project) => [project.id, project]));
  const recent: ProjectRef[] = [];
  for (const project of current ? [current, ...recents] : recents) {
    if (recent.length === RECENT_PROJECT_LIMIT) break;
    if (recent.some((shown) => shown.id === project.id)) continue;
    // The list's copy carries the name as it is now.
    const fresh = listed.get(project.id);
    if (fresh) recent.push(fresh);
    else if (mine.more || project === current) recent.push(project);
  }
  const rest = mine.more
    ? []
    : byName(mine.projects.filter((project) => !recent.some((shown) => shown.id === project.id)));
  return { recent, rest };
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

/**
 * Where selecting a project goes. A project-scoped list stays where it is and
 * re-reads under the new project, keeping its own filters (Teams' tab and
 * search). Anything else — a detail page, whose resource belongs to the
 * previous project, or an unscoped screen such as Projects — goes where a
 * Projects row would (`useSelectProjectTarget`): the screen `?next=` names, or
 * the console's landing for that project.
 */
function useScopeTarget(): (projectId: string) => SwitcherOption["link"] {
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
  /** The list's caption, as the design's menu label draws it (`TEAMS`). */
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
        <ul aria-label={ariaLabel} className="flex flex-col">
          {rows.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</li>
          ) : (
            // Links, not buttons: selecting a team is a navigation — the team
            // is the page.
            rows.map((option) => {
              const selected = option.id === currentId;
              return (
                <li
                  key={option.id}
                  // By id, not by label: two teams may share a name.
                  aria-current={selected ? "true" : undefined}
                >
                  <Link {...option.link} onClick={() => setOpen(false)} className={ROW}>
                    <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate text-sm text-foreground">{option.label}</span>
                    {selected && (
                      <Check size={16} className="shrink-0 text-foreground" aria-hidden />
                    )}
                  </Link>
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
              // Laid out like a row: icon, then the label in line with the
              // names above.
              className={ROW}
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

/**
 * A list row: 32px, glyph, name, and a check on the current one. The focus
 * ring is the buttons' (`ui/button.tsx`): the background alone is also the
 * hover state, so it cannot be what tells a keyboard user where focus is.
 */
const ROW =
  "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";
