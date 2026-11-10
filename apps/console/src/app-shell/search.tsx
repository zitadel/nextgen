import { useNavigate } from "@tanstack/react-router";
import { Boxes, Copy, type LucideIcon, Plus, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAsync } from "@/hooks/use-async";
import { TYPING_PAUSE_MS, useDebounced } from "@/hooks/use-debounced";
import { useProjectSearch } from "@/features/projects/my-projects";
import { useProjectScope, useSelectedProject } from "@/features/projects/project-scope";
import { search } from "@/features/search/api";
import {
  NO_ANSWER,
  OTHER_TYPES,
  type SearchHit,
  type SearchResultType,
  USER_SEARCH_MIN_LENGTH,
  USER_TYPES,
  hasMore,
  hitsFor,
} from "@/features/search/model";
import { recentHits, rememberHit } from "@/features/search/recents";
import { AddTeamSheet } from "@/features/teams/components/add-team-sheet";
import { AddUserSheet } from "@/features/users/components/add-user-sheet";
import { cn } from "@/lib/utils";

import type { NavIcon } from "@/nav";
import { type NavItem, useNavItems } from "./use-nav-items";

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
 * Groups, top to bottom: what was opened from here last, until something is
 * typed; pages in the selected project; actions in it (the drawers its list
 * screens open, and its id to copy); what `POST /search` finds in it (root ADR
 * 087), which is users, teams and configuration (user schemas, login flows,
 * identity providers), each matched and ranked on the server, an id pasted
 * into the field included; projects, matched on the server across every
 * project the person can act on; and you (the Settings sidebar's pages).
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

interface Result {
  id: string;
  /** A Lucide glyph, or the sidebar's own icon type (which Lucide satisfies). */
  icon: LucideIcon | NavIcon;
  label: string;
  /** Muted text on the right: where the result lives. */
  context?: string;
  go: () => void;
}

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  // The drawer an action opened. It outlives the palette, which closes first.
  const [adding, setAdding] = useState<"user" | "team" | null>(null);
  const navigate = useNavigate();
  const projectId = useProjectScope();
  // One round of requests per pause in typing, not per keystroke.
  const typed = useDebounced(open ? query.trim() : "", TYPING_PAUSE_MS);
  // Users apart from the rest, so the quick types do not wait for them.
  const users = useAsync(
    typed.length >= USER_SEARCH_MIN_LENGTH && projectId
      ? () => search(projectId, typed, USER_TYPES, HITS_PER_TYPE)
      : null,
    NO_ANSWER,
    [typed, projectId],
  );
  const others = useAsync(
    typed && projectId ? () => search(projectId, typed, OTHER_TYPES, HITS_PER_TYPE) : null,
    NO_ANSWER,
    [typed, projectId],
  );
  // The first page until something is typed, then the server's matches; each
  // answer stays until the next lands, so the group never empties mid-typing.
  const projects = useProjectSearch(open ? query : "", PROJECT_RESULTS);
  const pages = useNavItems();
  const account = useNavItems("account");

  // A fresh palette each time it opens.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const projectName = useSelectedProject()?.name;
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const matches = (text: string) => !q || text.toLowerCase().includes(q);
    const close = (go: () => void) => () => {
      onOpenChange(false);
      go();
    };

    // Every page of a sidebar, in its order.
    const navResults = (items: NavItem[]): Result[] =>
      items
        .filter((item) => matches(item.nav.label))
        .map((item) => ({
          id: `page:${item.to}`,
          icon: item.nav.icon,
          label: item.nav.label,
          go: close(() => void navigate({ to: item.to })),
        }));

    // What the palette does in the selected project: what its list screens'
    // own buttons do. The server refuses what the person may not do, as it
    // does there.
    const actions: Result[] = projectId
      ? [
          {
            id: "action:add-user",
            icon: Plus,
            label: "Add user",
            go: close(() => setAdding("user")),
          },
          {
            id: "action:add-team",
            icon: Plus,
            label: "Add team",
            go: close(() => setAdding("team")),
          },
          {
            id: "action:copy-project-id",
            icon: Copy,
            label: "Copy project ID",
            context: projectId,
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
    // A row without a subtitle says which project it is in.
    const hitResult = (hit: SearchHit, group: string): Result => ({
      id: `${group}:${hit.type}:${hit.id}`,
      icon: iconOf(hit.type),
      label: hit.title,
      context: hit.subtitle ?? projectName,
      go: close(() => {
        if (projectId) rememberHit(projectId, hit);
        void openHit(hit);
      }),
    });
    // What the server found of one type, for the text in the field now
    // (`hitsFor`).
    const hitResults = (answer: typeof users, type: SearchResultType): Result[] =>
      hitsFor(answer ?? NO_ANSWER, query, type).map((hit) => hitResult(hit, "hit"));

    const userResults = hitResults(users, "user");
    if (hasMore(users ?? NO_ANSWER, query, "user")) {
      // The palette shows the best few; the Users list searches the same
      // text across every page.
      userResults.push({
        id: "users:all",
        icon: Search,
        label: `See all users matching “${query.trim()}”`,
        go: close(() => void navigate({ to: "/users", search: { q: query.trim() } })),
      });
    }

    const projectResults: Result[] = (projects?.projects ?? []).map((project) => ({
      id: `project:${project.id}`,
      icon: Boxes,
      label: project.name,
      // Selecting a project is a navigation: the selection lives in the URL.
      go: close(() => void navigate({ to: "/", search: { project: project.id } })),
    }));

    return [
      {
        heading: "Recent",
        // Until something is typed: then the server's matches take over.
        results:
          !q && open && projectId
            ? recentHits(projectId).map((hit) => hitResult(hit, "recent"))
            : [],
      },
      {
        heading: projectName ? `Pages in ${projectName}` : "Pages",
        results: navResults(pages),
      },
      { heading: "Actions", results: actions },
      { heading: "Users", results: userResults },
      { heading: "Teams", results: hitResults(others, "team") },
      {
        heading: "Configuration",
        results: [
          ...hitResults(others, "schema"),
          ...hitResults(others, "flow_definition"),
          ...hitResults(others, "idp"),
        ],
      },
      { heading: "Projects", results: projectResults },
      { heading: "Account", results: navResults(account) },
    ].filter((group) => group.results.length > 0);
    // `open` is here for the recent hits, which are read when the palette opens.
  }, [
    pages,
    account,
    users,
    others,
    projects,
    projectId,
    projectName,
    q,
    query,
    open,
    navigate,
    onOpenChange,
  ]);

  return (
    <>
      <SearchPalette
        open={open}
        onOpenChange={onOpenChange}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
      />
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
  try {
    await navigator.clipboard.writeText(projectId);
    toast.success("Project ID copied");
  } catch {
    toast.error("Could not copy the project ID");
  }
}

/** The palette itself: the field and the groups it is given. */
function SearchPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  groups: { heading: string; results: Result[] }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={PALETTE}>
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a page, an action, a user, a team, configuration or a project.
        </DialogDescription>
        {/* Filtering is ours, not cmdk's: what the server found arrives
            already matched and ranked, and the pages match as a substring,
            any case. */}
        <Command shouldFilter={false} className="bg-popover">
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={onQueryChange}
              placeholder="Go to a page, user, team or project"
              aria-label="Search"
              className="h-12 pr-12 text-[15px]"
            />
            <Kbd className="absolute top-1/2 right-3 -translate-y-1/2">esc</Kbd>
          </div>
          <CommandList className="max-h-[340px] p-1.5">
            <CommandEmpty className="px-2 py-2 text-xs tracking-wide text-muted-foreground uppercase">
              Nothing matches “{query.trim()}”
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading} className={GROUP}>
                {group.results.map((result) => (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    onSelect={result.go}
                    className="gap-2.5 rounded-md px-2 py-2"
                  >
                    <result.icon aria-hidden />
                    <span className="truncate">{result.label}</span>
                    {result.context && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {result.context}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <p className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">
            ↑↓ to move · Enter to open · Searching inside a list stays in that list’s toolbar
          </p>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** How many of each kind the server is asked for: the best few, not a list. */
const HITS_PER_TYPE = 5;
const PROJECT_RESULTS = 8;

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
