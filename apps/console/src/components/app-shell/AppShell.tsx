import { Link, useMatchRoute } from "@tanstack/react-router";
// `BookOpen` / `Search` return with the parked footer items below.
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { type ThemePreference, useTheme } from "../../theme";
import { ContextSwitcher } from "./ContextSwitcher";
import { ZitadelMark } from "./icons";
import { useNavItems } from "./use-nav-items";

/**
 * Console shell built on shadcn's `Sidebar` block (the "Sidebar 08." Figma
 * frame, `j3qqriDab6WQfrlgLujf4Y`). `collapsible="icon"` gives the 256px →
 * icon-rail collapse with tooltips, ⌘/Ctrl+B, mobile off-canvas, and rail —
 * all from the component. The context bar (sidebar trigger + org/project
 * switchers + theme toggle) sits at the top of the content column. Colours come
 * from `@zitadel/design-tokens` via the shadcn utility names; the sidebar
 * surface uses `background` per the design (see `ui/sidebar.tsx`).
 */
export function AppShell({
  children,
  user,
  onSignOut,
}: {
  children: ReactNode;
  /** Signed-in identity shown in the sidebar footer (Console ADR 0003). */
  user?: ShellUser;
  /** Sign-out action for the footer user menu. */
  onSignOut?: () => void;
}) {
  return (
    <SidebarProvider defaultOpen={readSidebarOpen()}>
      <AppSidebar user={user} onSignOut={onSignOut} />
      <SidebarInset>
        <ContextBar />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

/** The signed-in identity as the shell renders it. */
export interface ShellUser {
  name?: string;
  email?: string;
  userId?: string;
}

/** Restore the collapse state shadcn persists in the `sidebar_state` cookie. */
function readSidebarOpen(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

function AppSidebar({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const items = useNavItems();
  const matchRoute = useMatchRoute();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-[108px] flex-row items-center gap-2 px-6 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <Link to="/" aria-label="Home" className="inline-flex items-center">
          <ZitadelMark size={32} className="text-sidebar-foreground" aria-hidden />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup role="navigation" aria-label="Primary" className="py-0">
          <SidebarMenu className="gap-3 px-4 group-data-[collapsible=icon]:px-0">
            {items.map((item) => {
              const Icon = item.nav.icon;
              const label = item.nav.label;
              if (!item.to) {
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      tooltip={label}
                      className="cursor-default font-serif"
                      aria-disabled="true"
                      title={`${label} — not available yet`}
                      onClick={(event) => event.preventDefault()}
                    >
                      {Icon && <Icon aria-hidden />}
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              }
              // A parent with children highlights only on an exact match: the
              // child paths sit under it (`/schemas` is a sibling route, but
              // `Users` fuzzy-matching its own subtree would light both rows).
              const active = !!matchRoute({ to: item.to, fuzzy: item.to !== "/" });
              return (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={label}
                    className="font-serif"
                  >
                    <Link to={item.to} title={label}>
                      {Icon && <Icon aria-hidden />}
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.children.length > 0 && (
                    <SidebarMenuSub>
                      {item.children.map((child) => (
                        <SidebarMenuSubItem key={child.nav.label}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={!!matchRoute({ to: child.to, fuzzy: true })}
                            className="font-serif"
                          >
                            <Link to={child.to} title={child.nav.label}>
                              <span>{child.nav.label}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="gap-2">
          {/* Search and Documentation are parked: both rendered as ordinary
              enabled buttons with no handler, so clicking them did nothing at
              all — the worst of the three states, since they looked live.

              Search needs a cross-resource query endpoint; ADR 031's
              `POST /{resource}/query` exists only for projects today, so there
              is nothing to search across. Documentation needs a published URL
              for the docs site to point at.

              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Search" className="font-serif">
                  <Search aria-hidden />
                  <span>Search</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Documentation" className="font-serif">
                  <BookOpen aria-hidden />
                  <span>Documentation</span>
                </SidebarMenuButton>
              </SidebarMenuItem> */}
          <UserMenuItem user={user} onSignOut={onSignOut} />
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/**
 * Footer user entry: the signed-in identity from `GET /sessions/me`
 * (name → email → user id fallback, per the API's identity-hydration
 * contract) with a menu carrying the sign-out action (Console ADR 0003).
 * Console-local chrome by design — the dark-only `<zitadel-session>` pair is
 * not theme-portable yet (root AGENTS.md bucket rule).
 */
function UserMenuItem({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const displayName = user?.name ?? user?.email ?? user?.userId ?? "Signed in";
  // Show the email as the secondary line only when the name is the primary.
  const secondary = user?.name ? user.email : undefined;

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            tooltip={displayName}
            className="font-serif"
            aria-label={`Account: ${displayName}`}
          >
            <span
              aria-hidden
              className="size-8 shrink-0 rounded-lg bg-[linear-gradient(232deg,#f25543_17%,#0f0f11_75%)]"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
              <span className="truncate text-[14px] text-sidebar-foreground">{displayName}</span>
              {secondary && (
                <span className="truncate text-[12px] text-muted-foreground">{secondary}</span>
              )}
            </span>
            <ChevronsUpDown className="ml-auto text-muted-foreground" aria-hidden />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuItem onSelect={() => onSignOut?.()} disabled={!onSignOut}>
            <LogOut aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function ContextBar() {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-background px-2 pt-3 md:items-center md:px-4 md:pt-7">
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        {/* Desktop only — mobile keeps the persistent Sidebar 07. icon rail. */}
        <SidebarTrigger className="hidden text-foreground md:inline-flex" />
        <ContextSwitcher />
      </div>
      <ThemeToggle />
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectIndex = (index: number) => {
    const next = THEME_OPTIONS[index];
    if (!next) return;
    setPreference(next.value);
    optionRefs.current[index]?.focus();
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = THEME_OPTIONS.length - 1;
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = index === 0 ? last : index - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectIndex(nextIndex);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5 sm:inline-flex"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }, index) => {
        const active = preference === value;
        return (
          <button
            key={value}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={active ? 0 : -1}
            onClick={() => setPreference(value)}
            onKeyDown={(event) => onOptionKeyDown(event, index)}
            className={`inline-flex size-7 items-center justify-center rounded-sm ${
              active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={15} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
