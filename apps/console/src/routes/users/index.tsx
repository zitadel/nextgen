import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpDown, MoreVertical, Plus, Search, Users } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { api } from "../../api/zitadel";
import { field } from "../../lib/record";

export const Route = createFileRoute("/users/")({
  staticData: { nav: { label: "Users", order: 2, icon: Users } },
  loader: () => api.listUsers(),
  component: UsersScreen,
});

interface UserRow {
  id: string;
  name: string;
  email: string;
}

/** Platform-correct modifier for the search shortcut hint (⌘ on Apple, Ctrl elsewhere). */
function searchShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+F";
  const apple =
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    /Mac OS|iPhone|iPad|iPod/.test(navigator.userAgent);
  return apple ? "⌘F" : "Ctrl+F";
}

function UsersScreen() {
  const users = Route.useLoaderData();
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
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
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
    let next = users.map(toUserRow).filter((user) => {
      return (
        needle === "" ||
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle) ||
        user.id.toLowerCase().includes(needle)
      );
    });
    if (sortAsc !== null) {
      next = [...next].sort((a, b) =>
        sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
      );
    }
    return next;
  }, [users, query, sortAsc]);

  return (
    <div className="px-4 pb-8 pt-9 sm:px-8">
      <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">Users</h1>

      <div className="mt-6 flex flex-col gap-4 lg:h-10 lg:flex-row lg:items-center lg:justify-end">
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
            <col className="w-[240px]" />
            <col className="w-[280px]" />
            <col className="w-[280px]" />
            <col className="w-[60px]" />
          </colgroup>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <HeadCell
                sortable
                ariaSort={sortAsc === null ? "none" : sortAsc ? "ascending" : "descending"}
                onSort={() => setSortAsc((value) => (value === null ? true : !value))}
              >
                Name
              </HeadCell>
              <HeadCell>Email</HeadCell>
              <HeadCell>ID</HeadCell>
              <TableHead className="h-14 px-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  {users.length === 0 ? "No users yet." : "No users match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((user) => (
                <TableRow key={user.id} className="border-0 hover:bg-muted/40">
                  <TableCell className="h-11 truncate px-4 py-0">
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        <AvatarFallback>{initials(user.name)}</AvatarFallback>
                      </Avatar>
                      <Link
                        to="/users/$userId"
                        params={{ userId: user.id }}
                        className="truncate font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {user.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="h-11 truncate px-2 py-0 text-muted-foreground">
                    {user.email}
                  </TableCell>
                  <TableCell className="h-11 truncate px-2 py-0 text-foreground">
                    {user.id}
                  </TableCell>
                  <TableCell className="h-11 px-2 py-0">
                    <RowActions name={user.name} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function toUserRow(user: Record<string, unknown>, index: number): UserRow {
  const id = field(user, "id") ?? `unknown-user-${index}`;
  const email = field(user, "email") ?? "—";
  return {
    id,
    name: field(user, "username") ?? (email === "—" ? id : email),
    email,
  };
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
