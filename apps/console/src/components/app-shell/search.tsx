import { useNavigate } from "@tanstack/react-router";
import {
  Box,
  Boxes,
  Building2,
  CircleUserRound,
  List,
  type LucideIcon,
  Search,
} from "lucide-react";
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
import { useAsync, useSessionCached } from "@/hooks/use-async";
import { readAccountTeam } from "@/lib/account";
import { useMyProjects, useProjectScope } from "@/lib/project-scope";
import { queryActiveTeams } from "@/lib/teams";
import { cn } from "@/lib/utils";

import type { NavIcon } from "./icons";
import { useNavItems } from "./use-nav-items";

/**
 * Console search: the top bar's trigger and the "Go to" palette it opens (⌘K /
 * Ctrl K anywhere). It moves you somewhere — a page, the account, a team, a
 * project, your profile. Searching *inside* a list stays in that list's own
 * toolbar; this is navigation, not a results page.
 *
 * Groups, top to bottom: pages in the selected project, the account, teams
 * (matched on the server, so a project with many is searched in full),
 * projects, you. Users are not offered: `POST /users/query` filters by id, schema, status and
 * team only — there is no email or name filter to search with.
 */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K"
      className={TRIGGER}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="truncate">Search…</span>
      <Kbd className="ml-auto">{IS_MAC ? "⌘K" : "Ctrl K"}</Kbd>
    </button>
  );
}

/** The palette's open state plus the global ⌘K / Ctrl K toggle. */
export function useSearchShortcut(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
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
  const projects = useMyProjects();
  const account = useSessionCached(readAccountTeam, null);
  // One request per pause in typing, not per keystroke.
  const typed = useDebounced(open ? query.trim() : "", TYPING_PAUSE_MS);
  const teams = useAsync(
    typed && projectId
      ? () => queryActiveTeams(projectId, { nameContains: typed, limit: TEAM_RESULTS })
      : null,
    [],
    [typed, projectId],
  );
  const pages = useNavItems();

  // A fresh palette each time it opens.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const projectName = projects?.find((project) => project.id === projectId)?.name;
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const matches = (text: string) => !q || text.toLowerCase().includes(q);
    const close = (go: () => void) => () => {
      onOpenChange(false);
      go();
    };

    // Every built page, nested ones included, in sidebar order.
    const pageResults: Result[] = pages
      .flatMap((item) => [item, ...item.children])
      .filter((item) => item.to && matches(item.nav.label))
      .map((item) => ({
        id: `page:${item.to}`,
        icon: item.nav.icon ?? List,
        label: item.nav.label,
        go: close(() => void navigate({ to: item.to })),
      }));

    const accountResults: Result[] =
      account && (matches("Account") || matches(account.name))
        ? [
            {
              id: "account",
              icon: Building2,
              label: "Account settings",
              context: account.name,
              go: close(
                () =>
                  void navigate({ to: "/settings/teams/$teamId", params: { teamId: account.id } }),
              ),
            },
          ]
        : [];

    const teamResults: Result[] = (q ? (teams ?? []) : []).map((team) => ({
      id: `team:${team.id}`,
      icon: Box,
      label: team.name,
      context: projectName,
      go: close(() => void navigate({ to: "/teams/$teamId", params: { teamId: team.id } })),
    }));

    const projectResults: Result[] = (projects ?? [])
      .filter((project) => matches(project.name))
      .map((project) => ({
        id: `project:${project.id}`,
        icon: Boxes,
        label: project.name,
        context: account?.name,
        // Selecting a project is a navigation: the selection lives in the URL.
        go: close(() => void navigate({ to: "/", search: { project: project.id } })),
      }));

    const youResults: Result[] = matches("Profile")
      ? [
          {
            id: "profile",
            icon: CircleUserRound,
            label: "Profile",
            go: close(() => void navigate({ to: "/settings/profile" })),
          },
        ]
      : [];

    return [
      { heading: projectName ? `Pages in ${projectName}` : "Pages", results: pageResults },
      { heading: "Account", results: accountResults },
      { heading: "Teams", results: teamResults },
      { heading: "Projects", results: projectResults },
      { heading: "You", results: youResults },
    ].filter((group) => group.results.length > 0);
  }, [pages, account, teams, projects, projectName, q, navigate, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={PALETTE}>
        <DialogTitle className="sr-only">Go to</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a page, the account, a team or a project.
        </DialogDescription>
        {/* Filtering is ours, not cmdk's: teams arrive already filtered by the
            server, and every group matches the same way (substring, any case). */}
        <Command shouldFilter={false} className="bg-popover">
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Go to a page, Project or Team"
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

const TYPING_PAUSE_MS = 200;
const TEAM_RESULTS = 8;

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

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

/** The bar's search field: 32px, up to 300px wide, a button that looks like an input. */
const TRIGGER =
  "flex h-8 w-full max-w-75 min-w-45 items-center gap-2 rounded-md border border-input bg-card pr-1.5 pl-2.5 text-left text-sm text-muted-foreground transition-colors outline-none hover:border-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** 560px, 70px from the top rather than centred, so results grow downward. */
const PALETTE =
  "top-[70px] translate-y-0 gap-0 overflow-hidden rounded-lg border-border bg-popover p-0 sm:max-w-[560px]";

/** Group captions: 11px uppercase, as the proposal draws them. */
const GROUP =
  "p-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase";
