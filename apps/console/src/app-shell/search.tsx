import { useNavigate } from "@tanstack/react-router";
import { Boxes, type LucideIcon, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

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
 * Groups, top to bottom: pages in the selected project; what `POST /search`
 * finds in it (root ADR 087), which is users, teams and configuration (user
 * schemas, login flows, identity providers), each matched and ranked on the
 * server, an id pasted into the field included; projects, matched on the
 * server across every project the person can act on; and the account
 * (Projects, then Settings' pages, which "Settings" finds too).
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
  const settings = useNavItems("settings");

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

    // Every page of a sidebar list, in its order. A list that has a name
    // marks its pages with it, and the name finds them all.
    const navResults = (items: NavItem[], list?: string): Result[] =>
      items
        .filter((item) => matches(item.nav.label) || (!!list && matches(list)))
        .map((item) => ({
          id: `page:${item.to}`,
          icon: item.nav.icon,
          label: item.nav.label,
          context: list,
          go: close(() => void navigate({ to: item.to })),
        }));

    // A hit wears the glyph of the sidebar page that lists its kind.
    const iconOf = (path: string): LucideIcon | NavIcon =>
      pages.find((item) => item.to === path)?.nav.icon ?? Search;
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
    // What the server found of one type, for the text in the field now
    // (`hitsFor`). A row without a subtitle says which project it is in.
    const hitResults = (answer: typeof users, type: SearchResultType, listPath: string): Result[] =>
      hitsFor(answer ?? NO_ANSWER, query, type).map((hit) => ({
        id: `${hit.type}:${hit.id}`,
        icon: iconOf(listPath),
        label: hit.title,
        context: hit.subtitle ?? projectName,
        go: close(() => void openHit(hit)),
      }));

    const userResults = hitResults(users, "user", "/users");
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
        heading: projectName ? `Pages in ${projectName}` : "Pages",
        results: navResults(pages),
      },
      { heading: "Users", results: userResults },
      { heading: "Teams", results: hitResults(others, "team", "/teams") },
      {
        heading: "Configuration",
        results: [
          ...hitResults(others, "schema", "/schemas"),
          ...hitResults(others, "flow_definition", "/flow-definitions"),
          ...hitResults(others, "idp", "/authentication"),
        ],
      },
      { heading: "Projects", results: projectResults },
      {
        heading: "Account",
        // The Settings row is a list, not a page: its pages stand in for it.
        results: [
          ...navResults(account.filter((item) => item.to !== SETTINGS_PATH)),
          ...navResults(settings, "Settings"),
        ],
      },
    ].filter((group) => group.results.length > 0);
  }, [
    pages,
    account,
    settings,
    users,
    others,
    projects,
    projectName,
    q,
    query,
    navigate,
    onOpenChange,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={PALETTE}>
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a page, a user, a team, configuration or a project.
        </DialogDescription>
        {/* Filtering is ours, not cmdk's: what the server found arrives
            already matched and ranked, and the pages match as a substring,
            any case. */}
        <Command shouldFilter={false} className="bg-popover">
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
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
