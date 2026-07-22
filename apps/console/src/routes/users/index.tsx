import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/users/")({
  staticData: { nav: { label: "Users", order: 2, icon: Users } },
  component: UsersScreen,
});

type UserType = "Human" | "Agent" | "Machine";
type UserStatus = "Active" | "Invited" | "Blocked";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  type: UserType;
  status: UserStatus;
  team: string;
  lastLogin: string;
}

/**
 * Users list — a faithful build of the Figma "Users" screen
 * (`j3qqriDab6WQfrlgLujf4Y`, node `277:290894`). Dummy data until the user
 * management API is wired, mirroring the designed rows.
 */
const USERS: UserRow[] = [
  { id: "1", name: "Maya Patel", email: "maya.patel@acme.com", role: "IAM Admin", type: "Human", status: "Active", team: "Atlas Engineering", lastLogin: "Today, 14:22" },
  { id: "2", name: "Oscar Nguyen", email: "oscar.nguyen@acme.com", role: "Human", type: "Human", status: "Active", team: "Nebula Research", lastLogin: "Jul 14, 2026" },
  { id: "3", name: "Sasha Kim", email: "sasha.kim@acme.com", role: "Agent", type: "Agent", status: "Invited", team: "Atlas Engineering", lastLogin: "Never" },
  { id: "4", name: "Theo Rossi", email: "theo.rossi@acme.com", role: "Machine", type: "Machine", status: "Active", team: "Horizon Ops", lastLogin: "Jul 10, 2026" },
  { id: "5", name: "Ines Larsson", email: "ines.larsson@acme.com", role: "Human", type: "Human", status: "Active", team: "Nebula Research", lastLogin: "Jul 15, 2026" },
  { id: "6", name: "Kenji Okafor", email: "kenji.okafor@acme.com", role: "Human", type: "Human", status: "Blocked", team: "Horizon Ops", lastLogin: "Jun 28, 2026" },
  { id: "7", name: "Amara Singh", email: "amara.singh@acme.com", role: "Machine", type: "Machine", status: "Active", team: "Atlas Engineering", lastLogin: "Jul 12, 2026" },
  { id: "8", name: "Felix Moreau", email: "felix.moreau@acme.com", role: "Human", type: "Human", status: "Active", team: "Nebula Research", lastLogin: "Jul 16, 2026" },
  { id: "9", name: "Zara Hendricks", email: "zara.hendricks@acme.com", role: "Agent", type: "Agent", status: "Active", team: "Horizon Ops", lastLogin: "Jul 11, 2026" },
  { id: "10", name: "Liam Tanaka", email: "liam.tanaka@acme.com", role: "Human", type: "Human", status: "Invited", team: "Atlas Engineering", lastLogin: "Never" },
  { id: "11", name: "Liam Tanaka", email: "liam.tanaka@acme.com", role: "Human", type: "Human", status: "Invited", team: "Atlas Engineering", lastLogin: "Never" },
  { id: "12", name: "Liam Tanaka", email: "liam.tanaka@acme.com", role: "Human", type: "Human", status: "Invited", team: "Atlas Engineering", lastLogin: "Never" },
  { id: "13", name: "Liam Tanaka", email: "liam.tanaka@acme.com", role: "Human", type: "Human", status: "Invited", team: "Atlas Engineering", lastLogin: "Never" },
  { id: "14", name: "Liam Tanaka", email: "liam.tanaka@acme.com", role: "Human", type: "Human", status: "Invited", team: "Atlas Engineering", lastLogin: "Never" },
  { id: "15", name: "Noor Becker", email: "noor.becker@acme.com", role: "Human", type: "Human", status: "Active", team: "Nebula Research", lastLogin: "Jul 08, 2026" },
];

const TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Human", label: "Human" },
  { value: "Agent", label: "Agent" },
  { value: "Machine", label: "Machine" },
];

/** Platform-correct modifier for the search shortcut hint (⌘ on Apple, Ctrl elsewhere). */
function searchShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+F";
  const apple =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    /Mac OS|iPhone|iPad|iPod/.test(navigator.userAgent);
  return apple ? "⌘F" : "Ctrl+F";
}

function UsersScreen() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [sortAsc, setSortAsc] = useState<boolean | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘F / Ctrl+F focuses the table search instead of the browser find bar —
  // only when the event isn't already targeting an editable field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let next = USERS.filter((user) => {
      const matchesTab = tab === "all" || user.type === tab;
      const matchesQuery =
        needle === "" ||
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle);
      return matchesTab && matchesQuery;
    });
    if (sortAsc !== null) {
      next = [...next].sort((a, b) =>
        sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
      );
    }
    return next;
  }, [tab, query, sortAsc]);

  return (
    <div className="px-4 pb-8 pt-9 sm:px-8">
      <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">Users</h1>

      {/* Mobile (`Dashboard xs`): tabs → search → full-width Add. Desktop: one row. */}
      <div className="mt-6 flex flex-col gap-4 lg:h-10 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="User type">
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex w-full flex-col gap-2.5 lg:w-auto lg:flex-row lg:items-center lg:gap-3">
          <div className="relative w-full lg:w-[373px]">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              name="user-search"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search users"
              className="pl-9 pr-14"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 flex h-5 -translate-y-1/2 items-center gap-0.5 rounded-sm bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground">
              {searchShortcutLabel()}
            </kbd>
          </div>
          <Button className="w-full lg:w-auto">
            Add
            <Plus aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-sidebar-border bg-card">
        <Table className="table-fixed text-xs">
          <colgroup>
            <col className="w-[177px]" />
            <col className="w-[179px]" />
            <col className="w-[120px]" />
            <col className="w-[80px]" />
            <col className="w-[177px]" />
            <col className="w-[168px]" />
            <col className="w-[60px]" />
          </colgroup>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <HeadCell
                sortable
                ariaSort={
                  sortAsc === null ? "none" : sortAsc ? "ascending" : "descending"
                }
                onSort={() => setSortAsc((value) => (value === null ? true : !value))}
              >
                Name
              </HeadCell>
              <HeadCell>Email</HeadCell>
              <HeadCell>Role</HeadCell>
              <HeadCell>Status</HeadCell>
              <HeadCell>Team</HeadCell>
              <HeadCell>Last login</HeadCell>
              <TableHead className="h-14 px-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((user) => (
              <TableRow key={user.id} className="border-0 hover:bg-muted/40">
                <TableCell className="h-11 truncate px-4 py-0">
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarFallback>{initials(user.name)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium text-foreground">{user.name}</span>
                  </div>
                </TableCell>
                <TableCell className="h-11 truncate px-2 py-0 text-muted-foreground">
                  {user.email}
                </TableCell>
                <TableCell className="h-11 px-2 py-0">
                  <Badge variant="outline">{user.role}</Badge>
                </TableCell>
                <TableCell className="h-11 px-2 py-0">
                  <StatusPill status={user.status} />
                </TableCell>
                <TableCell className="h-11 truncate px-2 py-0 text-foreground">{user.team}</TableCell>
                <TableCell className="h-11 truncate px-2 py-0 text-foreground">
                  {user.lastLogin}
                </TableCell>
                <TableCell className="h-11 px-2 py-0">
                  <RowActions name={user.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Static pagination stub matching the Figma frame. Page count, disabled
          state, and button handlers are wired when the user-management API
          loader lands (server-side paging: page size + cursor + total). */}
      <div className="mt-4 flex items-center justify-end gap-4 pr-1">
        <span className="text-xs text-muted-foreground tabular-nums">1/7</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="First page" disabled>
            <ChevronsLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Previous page" disabled>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next page" disabled>
            <ChevronRight />
          </Button>
          <Button variant="outline" size="icon" aria-label="Last page" disabled>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function HeadCell({
  children,
  sortable = false,
  ariaSort,
  onSort,
}: {
  children: ReactNode;
  sortable?: boolean;
  /** Current sort state for assistive tech; only set on sortable columns. */
  ariaSort?: "none" | "ascending" | "descending";
  onSort?: () => void;
}) {
  // Figma header labels use the display face (`font-serif` → APK Futural),
  // uppercase 12px with 0.96px tracking, inset by a ghost-button (h-9, px-2.5).
  const label = (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 py-2 font-serif text-xs uppercase tracking-[0.96px] text-muted-foreground">
      {children}
      {sortable && <ArrowUpDown className="size-4" aria-hidden />}
    </span>
  );
  return (
    <TableHead className="h-14 px-2 align-middle" aria-sort={sortable ? ariaSort : undefined}>
      {sortable ? (
        <button type="button" onClick={onSort} className="hover:[&>span]:text-foreground">
          {label}
        </button>
      ) : (
        label
      )}
    </TableHead>
  );
}

function StatusPill({ status }: { status: UserStatus }) {
  // In Figma every status is a Badge (px-2 py-0.5) — Active/Invited are the
  // transparent "ghost" variant, Blocked is destructive. Keeping the same
  // padding for all three keeps the text left-aligned across rows.
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
  if (status === "Blocked") {
    return (
      <span className={`${base} bg-destructive/10 text-destructive dark:bg-destructive/20`}>
        Blocked
      </span>
    );
  }
  return <span className={`${base} text-foreground`}>{status}</span>;
}

function RowActions({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem>View details</DropdownMenuItem>
        <DropdownMenuItem>Edit user</DropdownMenuItem>
        <DropdownMenuItem>Reset password</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Deactivate</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
