import { useNavigate } from "@tanstack/react-router";
import { Copy, type LucideIcon, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ProjectMark } from "@/components/project-mark";
import { copyText } from "@/lib/clipboard";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandItemText,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAsync } from "@/hooks/use-async";
import { TYPING_PAUSE_MS, useDebounced } from "@/hooks/use-debounced";
import type { ProjectRef } from "@/features/projects/model";
import { useMyProjects, useProjectSearch } from "@/features/projects/my-projects";
import { useProjectScope, useSelectedProject } from "@/features/projects/project-scope";
import { openingList, readRecentProjects } from "@/features/projects/recent-projects";
import { search } from "@/features/search/api";
import {
  NO_ANSWER,
  OTHER_TYPES,
  type Rankable,
  type SearchHit,
  type SearchResultType,
  USER_SEARCH_MIN_LENGTH,
  USER_TYPES,
  hasMore,
  hitsFor,
  ranked,
} from "@/features/search/model";
import { recentHits, rememberHit } from "@/features/search/recents";
import { AddTeamSheet } from "@/features/teams/components/add-team-sheet";
import { AddUserSheet } from "@/features/users/components/add-user-sheet";
import { cn } from "@/lib/utils";

import type { NavIcon } from "@/nav";
import { type NavItem, useNavItems } from "./use-nav-items";
import { SETTINGS_PATH } from "./user-menu";

/**
 * Console search: the sidebar's trigger and the "Go to" palette it opens (⌘K /
 * Ctrl K anywhere). It moves you somewhere — a page, a user, a team, a schema,
 * a project, your settings. Searching *inside* a list stays in that list's own
 * toolbar; this is navigation, not a results page.
 *
 * The trigger heads the sidebar's list rather than sitting in the top bar
 * (D27): in the bar it stacked on a list's own search, two fields a row apart.
 * A row of the sidebar's menu: a field at full width, its glyph in the rail.
 *
 * Before anything is typed the palette is a menu in groups, top to bottom:
 * what was opened from here last; pages in the selected project; actions in
 * it (the drawers its list screens open, and its id to copy); projects, the
 * selected and recent ones first, as the switcher opens; and the account
 * (Projects, then Settings' pages).
 *
 * Once something is typed it is one list, best match first, as Vercel's is
 * (D37): those pages and actions; what `POST /search` finds in the selected
 * project (root ADR 087), which is users, teams and configuration (user
 * schemas, login flows, identity providers), each matched on the server, an
 * id pasted into the field included; projects, matched on the server across
 * every project the person can act on; and the account's pages. They are
 * ranked together (`ranked`), the selected project's first among equally
 * good matches, and each row says beneath its name where it is, so a page of
 * the project and a project of that name read apart.
 */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        variant="outline"
        tooltip="Search"
        onClick={onOpen}
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        // A field, not a row: the card's fill and muted text, which hovering
        // keeps, where a row would take the accent.
        className="bg-card pr-1.5 text-muted-foreground hover:bg-card hover:text-muted-foreground"
      >
        <Search aria-hidden />
        <span className="truncate">Search…</span>
        <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">
          {IS_MAC ? "⌘K" : "Ctrl K"}
        </Kbd>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The palette's open state plus the global ⌘K / Ctrl K toggle. */
export function useSearchShortcut(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      // A held key toggles once, not on every repeat.
      if (event.repeat) return;
      setOpen((current) => {
        // Not over another open dialog, sheet or confirmation (the
        // palette's own is fine: the shortcut closes it).
        if (
          !current &&
          document.querySelector(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          )
        ) {
          return current;
        }
        return !current;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return [open, setOpen];
}

/** One row of the palette. */
interface Result {
  id: string;
  /** What heads the row: a glyph, or a project's mark. */
  icon: ReactNode;
  label: string;
  /** Beneath the label: where the result is, or what tells it from another of its name. */
  description?: string;
  go: () => void;
}

/** A row of the typed list, which ranks every kind together. */
interface RankedResult extends Result, Rankable {}

/** A group of rows, headed before anything is typed and not after. */
interface ResultGroup {
  heading?: string;
  results: Result[];
}

/**
 * Kinds in the order a tie between equally good matches of one place falls:
 * what the sidebar lists, what it does, what the project holds, then what is
 * above every project: projects first, since a project's page opens only once
 * one is chosen.
 */
const KIND = {
  page: 0,
  action: 1,
  user: 2,
  team: 3,
  configuration: 4,
  project: 5,
  // A project's page while no project is selected: opening it asks for one.
  pageOfNoProject: 6,
  account: 7,
} as const;

const HIT_KIND: Record<SearchResultType, number> = {
  user: KIND.user,
  team: KIND.team,
  schema: KIND.configuration,
  flow_definition: KIND.configuration,
  idp: KIND.configuration,
};

export function SearchDialog({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose recent projects the palette opens on. */
  userId?: string;
}) {
  // The drawer an action opened. It outlives the palette, which closes first.
  const [adding, setAdding] = useState<"user" | "team" | null>(null);
  const navigate = useNavigate();
  const projectId = useProjectScope();
  // Counts the openings, to key the palette by. The dialog keeps its content
  // mounted while it animates out, so reopening it in that moment would
  // otherwise bring back the last opening's text.
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) {
    setOpening({ open, count: open ? opening.count + 1 : opening.count });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false} className={PALETTE}>
          <DialogTitle className="sr-only">Go to</DialogTitle>
          <DialogDescription className="sr-only">
            Search for a page, an action, a user, a team, configuration or a project.
          </DialogDescription>
          {/* Mounted only while the palette is open, and anew for each
              opening: it starts empty, and closing it drops its pending
              searches and timers instead of letting them land on a closed
              palette. */}
          <SearchPalette
            key={opening.count}
            onOpenChange={onOpenChange}
            onAdd={setAdding}
            userId={userId}
          />
        </DialogContent>
      </Dialog>
      {projectId && (
        <>
          <AddUserSheet
            open={adding === "user"}
            onOpenChange={(next) => setAdding(next ? "user" : null)}
            onCreated={(user) => navigate({ to: "/users/$userId", params: { userId: user.id } })}
          />
          <AddTeamSheet
            open={adding === "team"}
            onOpenChange={(next) => setAdding(next ? "team" : null)}
            onCreated={(team) => navigate({ to: "/teams/$teamId", params: { teamId: team.id } })}
          />
        </>
      )}
    </>
  );
}

/** The palette's field and its list, with the searches behind them. */
function SearchPalette({
  onOpenChange,
  onAdd,
  userId,
}: {
  onOpenChange: (open: boolean) => void;
  /** Opens the drawer an action names, which outlives the palette. */
  onAdd: (kind: "user" | "team") => void;
  userId: string | undefined;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const projectId = useProjectScope();
  // One round of requests per pause in typing, not per keystroke.
  const typed = useDebounced(query.trim(), TYPING_PAUSE_MS);
  // Users apart from the rest, so the quick types do not wait for them.
  // A search that is not sent, or fails, answers its text with nothing, so
  // the palette can tell an answer from one still on its way.
  const nothing = { ...NO_ANSWER, term: typed };
  const users = useAsync(
    typed.length >= USER_SEARCH_MIN_LENGTH && projectId
      ? () => search(projectId, typed, USER_TYPES, HITS_PER_TYPE)
      : null,
    nothing,
    [typed, projectId],
  );
  const others = useAsync(
    typed && projectId ? () => search(projectId, typed, OTHER_TYPES, HITS_PER_TYPE) : null,
    nothing,
    [typed, projectId],
  );
  // The server's matches once something is typed; each answer stays until the
  // next lands, less what the typing has since ruled out.
  const found = useProjectSearch(query, PROJECT_RESULTS);
  // Before anything is typed: the selected and recent projects, then the rest
  // while one page holds them all (`openingList`), as the switcher opens.
  const mine = useMyProjects();
  // Read as the palette opens, so it holds what was opened since it last did.
  const recentProjects = useMemo(() => readRecentProjects(userId), [userId]);
  const pages = useNavItems();
  const account = useNavItems("account");
  const settings = useNavItems("settings");

  const selected = useSelectedProject();
  const projectName = selected?.name;
  // Where the selected project's rows are: its name, or its id until that is read.
  const place = projectId ? (projectName ?? projectId) : undefined;
  const q = query.trim().toLowerCase();

  const groups = useMemo((): ResultGroup[] => {
    const matches = (text: string) => !q || text.toLowerCase().includes(q);
    const close = (go: () => void) => () => {
      onOpenChange(false);
      go();
    };
    // In the typed list every row says where it is; in the menu its group does.
    const where = (description: string | undefined) => (q ? description : undefined);

    // Every page of a sidebar list, in its order. A list that has a name
    // marks its pages with it, and the name finds them all.
    const navResults = (
      items: NavItem[],
      { list, description, inProject, kind }: NavPlace,
    ): RankedResult[] =>
      items
        .filter((item) => matches(item.nav.label) || (!!list && matches(list)))
        .map((item) => ({
          id: `page:${item.to}`,
          icon: <item.nav.icon aria-hidden />,
          label: item.nav.label,
          description: list ?? description,
          inProject,
          kind,
          go: close(() => void navigate({ to: item.to })),
        }));

    // The project's pages. With none selected, opening one asks for one (D22).
    const pageResults = navResults(pages, {
      description: where(place ?? CHOOSE_A_PROJECT),
      inProject: projectId !== undefined,
      kind: projectId ? KIND.page : KIND.pageOfNoProject,
    });

    // What the palette does in the selected project: what its list screens'
    // own buttons do. The server refuses what the person may not do, as it
    // does there.
    const actions: RankedResult[] = projectId
      ? [
          {
            id: "action:add-user",
            icon: <Plus aria-hidden />,
            label: "Add user",
            description: where(place),
            inProject: true,
            kind: KIND.action,
            go: close(() => onAdd("user")),
          },
          {
            id: "action:add-team",
            icon: <Plus aria-hidden />,
            label: "Add team",
            description: where(place),
            inProject: true,
            kind: KIND.action,
            go: close(() => onAdd("team")),
          },
          {
            id: "action:copy-project-id",
            icon: <Copy aria-hidden />,
            label: "Copy project ID",
            // What it copies.
            description: projectId,
            inProject: true,
            kind: KIND.action,
            go: close(() => void copyProjectId(projectId)),
          },
        ].filter((action) => matches(action.label))
      : [];

    // A hit wears the glyph of the sidebar page that lists its kind.
    const iconOf = (type: SearchResultType): LucideIcon | NavIcon =>
      pages.find((item) => item.to === LIST_PATH[type])?.nav.icon ?? Search;
    const openHit = (hit: SearchHit) => {
      switch (hit.type) {
        case "user":
          return navigate({ to: "/users/$userId", params: { userId: hit.id } });
        case "team":
          return navigate({ to: "/teams/$teamId", params: { teamId: hit.id } });
        case "schema":
          return navigate({ to: "/schemas/$schemaId", params: { schemaId: hit.id } });
        case "flow_definition":
          return navigate({
            to: "/flow-definitions/$definitionId",
            params: { definitionId: hit.id },
          });
        case "idp":
          return navigate({ to: "/authentication/idps/$idpId", params: { idpId: hit.id } });
      }
    };
    // Beneath a hit: the server's second line (a user's identifier), then the
    // project it is in.
    const hitResult = (hit: SearchHit, group: string): RankedResult => {
      const Icon = iconOf(hit.type);
      return {
        id: `${group}:${hit.type}:${hit.id}`,
        icon: <Icon aria-hidden />,
        label: hit.title,
        // The server matches a user on their identifier too, which is this line.
        alias: hit.subtitle,
        description: [hit.subtitle, place].filter(Boolean).join(" · ") || undefined,
        inProject: true,
        kind: HIT_KIND[hit.type],
        go: close(() => {
          if (projectId) rememberHit(projectId, hit);
          void openHit(hit);
        }),
      };
    };
    // What the server found of one type, for the text in the field now
    // (`hitsFor`).
    const hitResults = (answer: typeof users, type: SearchResultType): RankedResult[] =>
      hitsFor(answer ?? NO_ANSWER, query, type).map((hit) => hitResult(hit, "hit"));

    // Beneath a project, as the switcher draws it (D21): its site's host, or
    // else its id, which tells two of one name apart.
    const projectResult = (project: ProjectRef): RankedResult => ({
      id: `project:${project.id}`,
      icon: <ProjectMark projectId={project.id} className="size-4" />,
      label: project.name,
      description: project.host ?? project.id,
      inProject: false,
      kind: KIND.project,
      // Selecting a project is a navigation: the selection lives in the URL.
      go: close(() => void navigate({ to: "/", search: { project: project.id } })),
    });

    // The Settings row is a list, not a page: its pages stand in for it.
    const accountResults = [
      ...navResults(
        account.filter((item) => item.to !== SETTINGS_PATH),
        { description: where(ACCOUNT), inProject: false, kind: KIND.account },
      ),
      ...navResults(settings, { list: "Settings", inProject: false, kind: KIND.account }),
    ];

    if (!q) {
      const current =
        selected?.name === undefined ? undefined : { ...selected, name: selected.name };
      const opening = mine ? openingList(mine, current, recentProjects) : { recent: [], rest: [] };
      // Past one page the list opens on the recent ones alone, since that
      // page is only the first of them. The palette still fills its group
      // from it, so it never opens on no project while there are some.
      const firstPage = (mine?.more ? mine.projects : []).filter(
        (project) => !opening.recent.some((recent) => recent.id === project.id),
      );
      return [
        {
          heading: "Recent",
          results: projectId ? recentHits(projectId).map((hit) => hitResult(hit, "recent")) : [],
        },
        { heading: projectName ? `Pages in ${projectName}` : "Pages", results: pageResults },
        { heading: "Actions", results: actions },
        {
          heading: "Projects",
          results: [...opening.recent, ...opening.rest, ...firstPage]
            .slice(0, PROJECT_RESULTS)
            .map(projectResult),
        },
        { heading: ACCOUNT, results: accountResults },
      ].filter((group) => group.results.length > 0);
    }

    const userResults = hitResults(users, "user");
    // Re-matched against the field: until the next answer lands, the last one
    // can name projects the typing has since ruled out.
    const projectResults = (found?.projects ?? [])
      .filter((project) => project.name.toLowerCase().includes(q))
      .map(projectResult);
    const all = ranked(query, [
      ...pageResults,
      ...actions,
      ...userResults,
      ...hitResults(others, "team"),
      ...hitResults(others, "schema"),
      ...hitResults(others, "flow_definition"),
      ...hitResults(others, "idp"),
      ...projectResults,
      ...accountResults,
    ]);
    // The palette shows the best few; the Users list searches the same text
    // across every page, the users the list has no room for among them. Its
    // row takes the list's last place, so the list never grows past the cap.
    const shown = all.slice(0, MAX_RESULTS);
    const seeAllUsers =
      hasMore(users ?? NO_ANSWER, query, "user") ||
      userResults.some((result) => !shown.includes(result));
    const best = seeAllUsers ? all.slice(0, MAX_RESULTS - 1) : shown;
    if (seeAllUsers) {
      best.push({
        id: "users:all",
        icon: <Search aria-hidden />,
        label: `See all users matching “${query.trim()}”`,
        description: place,
        inProject: true,
        kind: KIND.user,
        go: close(() => void navigate({ to: "/users", search: { q: query.trim() } })),
      });
    }
    return [{ results: best }];
  }, [
    pages,
    account,
    settings,
    users,
    others,
    found,
    mine,
    recentProjects,
    selected,
    projectId,
    projectName,
    place,
    q,
    query,
    navigate,
    onOpenChange,
    onAdd,
  ]);

  const text = query.trim();
  // Every search has answered the text in the field: until then an empty
  // list is not "nothing matches".
  const answered = users?.term === text && others?.term === text && (!text || found?.term === text);
  return (
    // Filtering is ours, not cmdk's: what the server found arrives already
    // matched and ranked, and the pages match as a substring, any case.
    <Command shouldFilter={false} className="bg-popover">
      <div className="relative">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Go to a page, user, team or project, or run an action"
          aria-label="Search"
          className="h-12 pr-12 text-[15px]"
        />
        <Kbd className="absolute top-1/2 right-3 -translate-y-1/2">esc</Kbd>
      </div>
      <CommandList className="max-h-[440px] p-1.5">
        {/* Says where it looked: users, teams and configuration are found in
            the selected project only, and in none without one. */}
        <CommandEmpty className="px-2 py-2 text-xs text-muted-foreground">
          {answered ? (
            <>
              <p className="tracking-wide uppercase">
                {place ? `Nothing in ${place} matches “${text}”` : `Nothing matches “${text}”`}
              </p>
              <p className="mt-1">
                {place
                  ? "Users, teams and configuration are found in the selected project only."
                  : "Choose a project to search its users, teams and configuration."}
              </p>
            </>
          ) : (
            <p className="tracking-wide uppercase">Searching…</p>
          )}
        </CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.heading ?? "ranked"} heading={group.heading} className={GROUP}>
            {group.results.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={result.go}
                className="gap-2.5 rounded-md px-2 py-2"
              >
                {result.icon}
                <CommandItemText label={result.label} description={result.description} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <p className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
        ↑↓ to move · Enter to open · Searching inside a list stays in that list’s toolbar
      </p>
    </Command>
  );
}

/** Where a sidebar list's pages are, and how they rank. */
interface NavPlace {
  /** The list's name, which marks its pages and finds them all. */
  list?: string;
  /** Beneath a page that has no list's name. */
  description?: string;
  inProject: boolean;
  kind: number;
}

/** Beneath a project's page while no project is selected: opening it asks for one. */
const CHOOSE_A_PROJECT = "Choose a project";

/** What is above every project: the menu's heading, and beneath its rows once typed. */
const ACCOUNT = "Account";

/** The list screen of each kind of hit: where its glyph comes from. */
const LIST_PATH: Record<SearchResultType, string> = {
  user: "/users",
  team: "/teams",
  schema: "/schemas",
  flow_definition: "/flow-definitions",
  idp: "/authentication",
};

/**
 * Puts the project's id on the clipboard and says so. A refused write, or a
 * missing clipboard on an insecure origin, says that instead of claiming a
 * copy.
 */
async function copyProjectId(projectId: string) {
  if (await copyText(projectId)) toast.success("Project ID copied");
  else toast.error("Could not copy the project ID");
}

/** How many of each kind the server is asked for: the best few, not a list. */
const HITS_PER_TYPE = 5;
const PROJECT_RESULTS = 8;
/** How many rows the typed list holds, as Vercel's holds a handful. */
const MAX_RESULTS = 8;

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded-sm border border-border px-1.5 font-mono text-[11px] leading-4 text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** 560px, 70px from the top rather than centred, so results grow downward. */
const PALETTE =
  "top-[70px] translate-y-0 gap-0 overflow-hidden rounded-lg border-border bg-popover p-0 sm:max-w-[560px]";

/** Group captions: 11px uppercase, as the proposal draws them. */
const GROUP =
  "p-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase";
