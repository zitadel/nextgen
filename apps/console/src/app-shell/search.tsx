import { useNavigate } from "@tanstack/react-router";
import { Box, Boxes, type LucideIcon, Search } from "lucide-react";
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
import { queryActiveTeams } from "@/features/teams/api";
import { cn } from "@/lib/utils";

import type { NavIcon } from "@/nav";
import { type NavItem, useNavItems } from "./use-nav-items";

/**
 * Console search: the sidebar's trigger and the "Go to" palette it opens (⌘K /
 * Ctrl K anywhere). It moves you somewhere — a page, a team, a project, your
 * settings. Searching *inside* a list stays in that list's own toolbar; this
 * is navigation, not a results page.
 *
 * The trigger heads the sidebar's list rather than sitting in the top bar
 * (D27): in the bar it stacked on a list's own search, two fields a row apart.
 * A row of the sidebar's menu: a field at full width, its glyph in the rail.
 *
 * Groups, top to bottom: pages in the selected project, teams (matched on the
 * server, so a project with many is searched in full), projects (matched on
 * the server too, across every project the person can act on), and you (the
 * Settings sidebar's pages). Users are not offered: `POST /users/query`
 * filters by id, schema, status and team only — there is no email or name
 * filter to search with.
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
  // One request per pause in typing, not per keystroke.
  const typed = useDebounced(open ? query.trim() : "", TYPING_PAUSE_MS);
  const teams = useAsync(
    typed && projectId
      ? () => queryActiveTeams(projectId, { nameContains: typed, limit: TEAM_RESULTS })
      : null,
    [],
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

    // Re-filtered against the live query: until the next debounced read lands,
    // the last one's answer can name teams the typing has already ruled out.
    const teamResults: Result[] = (q ? (teams ?? []) : [])
      .filter((team) => matches(team.name))
      .map((team) => ({
        id: `team:${team.id}`,
        icon: Box,
        label: team.name,
        context: projectName,
        go: close(() => void navigate({ to: "/teams/$teamId", params: { teamId: team.id } })),
      }));

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
      { heading: "Teams", results: teamResults },
      { heading: "Projects", results: projectResults },
      { heading: "Account", results: navResults(account) },
    ].filter((group) => group.results.length > 0);
  }, [pages, account, teams, projects, projectName, q, navigate, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={PALETTE}>
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a page, a team or a project.
        </DialogDescription>
        {/* Filtering is ours, not cmdk's: teams and projects arrive already
            filtered by the server, and every group matches the same way
            (substring, any case). */}
        <Command shouldFilter={false} className="bg-popover">
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Go to a page, project or team"
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

const TEAM_RESULTS = 8;
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
