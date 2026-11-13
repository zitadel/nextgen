import {
  Link,
  type LinkProps,
  useMatch,
  useMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  Box,
  Boxes,
  Check,
  ChevronsUpDown,
  Hexagon,
  type LucideIcon,
  Plus,
  Slash,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AddTeamSheet } from "@/features/teams/components/add-team-sheet";
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

import { usePlatformAccess } from "@/features/platform/access";
import { queryActiveTeams } from "@/features/teams/api";
import { useAsync } from "@/hooks/use-async";
import { withoutTrailingSlash } from "@/lib/base-path";
import { byName, type ProjectRef } from "@/features/projects/model";
import { useMyProjects, useProjectSearch } from "@/features/projects/my-projects";
import {
  type SelectedProject,
  useProjectScope,
  useSelectedProject,
  useSelectProjectTarget,
} from "@/features/projects/project-scope";
import {
  openingList,
  readRecentProjects,
  useRememberRecentProject,
} from "@/features/projects/recent-projects";

/**
 * The top bar's context, a path from the root down, as Vercel's bar runs from
 * the team to the project (D44): at the root, the root's pill alone; in a
 * project, the root as the way up, a slash, and the project's pill; on a
 * team's page, a slash and the team switcher after that.
 *
 * The root is the platform for someone who may act on it (D42), whose screens
 * it holds, and otherwise All projects. Every screen above every project is
 * the root's, Projects and Settings too: the bar names the root there, even
 * while a project stays selected for the way back (D36).
 *
 * The pill is the design system's searchable picker (`Combobox`): it opens on
 * a search field, matched on the server across every project the person can
 * act on, above the platform, in a section of its own, the selected project
 * and the ones they opened recently, and, while all their projects fit on one
 * page, every other one by name. The row the pill stands for is checked. Its
 * footer opens Projects. The team switcher is a `Popover` over the project's
 * active teams; its footer adds a team, opening the Add team drawer and then
 * the new team.
 */

/**
 * What the project pill says once the read has answered with nothing. Also the
 * fallback for a failed read, so neither case leaves a skeleton behind.
 */
const NO_PROJECTS = "No projects";

/** What the project pill says while projects exist but none is selected. */
const NO_SELECTION = "Select a project";

/**
 * The root for someone who may not act on the platform, whose root holds only
 * their projects (D44), and what the list's footer opens: Projects.
 */
const ALL_PROJECTS = "All projects";

/** The root for someone who may act on the platform project (D42, D44). */
const PLATFORM = "Platform";

/** What tells the platform's row from a project's in the list. */
const PLATFORM_DESCRIPTION = "Above every project";

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

export function ContextSwitcher({
  userId,
  root = false,
}: {
  userId?: string;
  /**
   * The screen is the root's (D44): Projects, Settings, the person's profile,
   * or a screen drawn for the reserved platform project (D42). The bar names
   * the root alone then, never a project, whichever stays selected (D36).
   */
  root?: boolean;
}) {
  // The pill shows the selected project (`?project=`, `src/features/projects/project-scope.ts`),
  // never `getConsoleProjectId()`: that is the project the console signs into —
  // the platform project on a platform deployment — which is not what anybody
  // means here unless it was selected. Never named from a search's matches,
  // which come and go as the person types; by its id until its name is read.
  // Read here, once, for the pill and for the person's recent projects: a
  // project selected anywhere — the switcher, Projects, search, a link — is the
  // one they opened last.
  const current = useSelectedProject();
  // The root is never one of the person's projects, nor is a project kept
  // selected above every project newly opened there.
  useRememberRecentProject(userId, root ? undefined : current);
  const selected = useProjectScope();
  const teamId = useParams({ strict: false, select: (params) => params.teamId });
  // The platform project, for someone who may act on it: the root is named
  // for it then, and its list offers it apart from the projects.
  const platform = usePlatformAccess();

  return (
    <nav aria-label="Context" className="flex min-w-0 items-center gap-2">
      {/* The root heads the bar, as Vercel's team heads a project: at the root
          it is the pill, in a project the way up to it, then the project's pill. */}
      {!root && (
        <>
          <RootCrumb platform={platform} />
          <CrumbSlash />
        </>
      )}
      <ProjectSwitcher userId={userId} current={current} root={root} platform={platform} />
      {/* The team switcher joins the bar once a team is open — the team is the
          context then, and following another team from the list switches it.
          Teams are not a standing selection the way projects are: no screen
          other than the team's own reads one. */}
      {teamId && selected && !root && (
        <>
          <CrumbSlash />
          {/* Keyed: another project's teams must not show while this one's load. */}
          <TeamSwitcher key={selected} projectId={selected} teamId={teamId} />
        </>
      )}
    </nav>
  );
}

/** The slash between two levels of the bar, as the design's navbar draws it. */
function CrumbSlash() {
  return <Slash aria-hidden className="size-3.5 shrink-0 -rotate-[20deg] text-border" />;
}

/**
 * What the root is called, and its glyph (D44): the platform, for someone who
 * may act on it, whose screens it holds; for anyone else it holds only their
 * projects, and says so.
 */
function rootName(platform: string | undefined): { label: string; Icon: LucideIcon } {
  return platform ? { label: PLATFORM, Icon: Hexagon } : { label: ALL_PROJECTS, Icon: Boxes };
}

/**
 * The way up from a project to the root, in the bar: Projects, which the root
 * opens on. The selection rides along (D36), so the way back is the pill.
 */
function RootCrumb({ platform }: { platform: string | undefined }) {
  const { label, Icon } = rootName(platform);
  return (
    <Link to="/projects" className={cn(TRIGGER, "text-muted-foreground hover:text-foreground")}>
      <Icon size={16} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate leading-5">{label}</span>
    </Link>
  );
}

/**
 * The pill and its list. At the root it names the root; in a project, the
 * project. Choosing one is a navigation, as a link would be: the selection
 * lives in the URL. The list offers the platform apart, in a section of its
 * own above the projects, for someone who may act on it; then the selected and
 * recent projects and, past the first page, no more than those, since that
 * page is only the oldest ones; the search reaches the rest. Its footer opens
 * Projects, the list of all of them.
 */
function ProjectSwitcher({
  userId,
  current,
  root,
  platform,
}: {
  userId: string | undefined;
  /** The selected project, named once it is read. */
  current: SelectedProject | undefined;
  root: boolean;
  platform: string | undefined;
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
  // The platform is the root, not a project: its own section, first, and
  // found by its name like the rest.
  const platformGroup: ComboboxGroup = {
    heading: PLATFORM,
    options:
      platform && PLATFORM.toLowerCase().includes(term)
        ? [
            {
              value: platform,
              label: PLATFORM,
              description: PLATFORM_DESCRIPTION,
              icon: <Hexagon aria-hidden />,
            },
          ]
        : [],
  };
  let groups: ComboboxGroup[] = [];
  let emptyLabel = LOADING;
  if (term) {
    // Re-filtered against the live query: until the next debounced read lands,
    // the last one's answer can name projects the typing has already ruled out.
    const matches = (found?.projects ?? []).filter((project) =>
      project.name.toLowerCase().includes(term),
    );
    groups = [platformGroup, { heading: "Projects", options: byName(matches).map(toOption) }];
    emptyLabel = found?.term.toLowerCase() === term ? NO_MATCHES : SEARCHING;
  } else if (mine) {
    const named =
      root || current?.name === undefined ? undefined : { ...current, name: current.name };
    const { recent, rest } = openingList(mine, named, recents);
    groups = [
      platformGroup,
      { heading: "Recent", options: recent.map(toOption) },
      { heading: "Projects", options: rest.map(toOption) },
    ];
    emptyLabel = mine.projects.length === 0 && !mine.more ? NO_PROJECTS : TYPE_TO_FIND;
  }

  const label = current && (current.name ?? current.id);
  // The row the pill stands for, which the list marks: the root, or the
  // project. A project kept selected above every project (D36) is not where
  // the person is, so the root is marked then.
  const marked = root ? platform : selected;
  const { label: rootLabel, Icon: RootIcon } = rootName(platform);

  return (
    <Combobox open={open} onOpenChange={changeOpen}>
      <ComboboxAnchor asChild>
        <button type="button" aria-label="Switch project" className={TRIGGER}>
          {root ? (
            <RootIcon size={16} className="shrink-0 text-foreground" aria-hidden />
          ) : selected ? (
            <ProjectMark projectId={selected} className="size-4" />
          ) : (
            <Boxes size={16} className="shrink-0 text-foreground" aria-hidden />
          )}
          {root ? (
            <span className="min-w-0 truncate leading-5 text-foreground">{rootLabel}</span>
          ) : mine === undefined ? (
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
        selected={marked ? [marked] : []}
        searchPlaceholder={FIND_PROJECT}
        emptyLabel={emptyLabel}
        search={{ query, onQueryChange: setQuery }}
        footer={{
          label: ALL_PROJECTS,
          icon: <Boxes aria-hidden />,
          onSelect: () => void navigate({ to: "/projects" }),
        }}
        label="Projects"
        // Wider than the pill: a row carries a name and its host or id.
        className="w-72"
        onSelect={(projectId) => void navigate(scopeTo(projectId, projectId === platform))}
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
 *
 * The platform is the root's (D42): a list of the root's stays too, but the
 * root has no Overview, so from anywhere else it opens Projects, the root's
 * home.
 */
function useScopeTarget(): (projectId: string, toRoot: boolean) => SwitcherOption["link"] {
  const leaf = useMatches({ select: (matches) => matches[matches.length - 1] });
  const selectTarget = useSelectProjectTarget();
  const path = leaf && withoutTrailingSlash(leaf.fullPath);
  const stays = leaf?.staticData.scope === "project" && leaf.staticData.nav !== undefined;
  return (projectId, toRoot) => {
    if (stays && path && !(toRoot && path === OVERVIEW_PATH)) {
      return {
        to: path,
        search: (prev: Record<string, unknown>) => ({ ...prev, project: projectId }),
      };
    }
    return toRoot ? { to: "/projects" } : selectTarget(projectId);
  };
}

/** A project's home, Overview, which the root leaves out (D42). */
const OVERVIEW_PATH = "/";

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
 * The bar's switcher: a borderless 36px button — glyph, name, chevrons — that
 * fills only on hover or while open. Height, padding, gap, radius and the
 * hover fill are the sidebar rows' (`SidebarMenuButton`), so the bar and the
 * sidebar read as one set of controls rather than two contrasts. Capped so a
 * long name truncates rather than running the bar's width.
 */
const TRIGGER =
  "flex h-9 max-w-64 min-w-0 items-center gap-2.5 rounded-md px-3 text-sm transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent";

/**
 * A list row: 32px, glyph, name, and a check on the current one. The focus
 * ring is the buttons' (`ui/button.tsx`): the background alone is also the
 * hover state, so it cannot be what tells a keyboard user where focus is.
 */
const ROW =
  "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";
