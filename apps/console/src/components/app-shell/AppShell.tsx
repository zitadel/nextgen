import { Link, useMatchRoute } from "@tanstack/react-router";
// `BookOpen` / `Search` return with the parked footer items below.
import { ArrowLeft, ChevronsUpDown, Monitor, Moon, Sun } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
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
  useSidebar,
} from "@/components/ui/sidebar";

import { type ThemePreference, useTheme } from "../../theme";
import { ContextSwitcher } from "./ContextSwitcher";
import { ZitadelLogo } from "./icons";
import { useNavItems, useSettingsNavItems } from "./use-nav-items";

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
      {/* `min-w-0` because the inset is a flex item, and a flex item's default
          `min-width: auto` makes it grow to fit its widest content instead of
          letting that content scroll. Without it a table wider than the viewport
          stretches the whole page and the window scrolls sideways, rather than
          the table scrolling inside its own card. */}
      <SidebarInset className="min-w-0">
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

/** Route prefix that puts the shell into its Settings view. */
const SETTINGS_PATH = "/settings";

/**
 * The collapsed rail's 44px header band. The rail owns the collapse toggle —
 * the context bar hides its own while collapsed, so the two never compete.
 */
const RAIL_HEADER = "hidden h-11 items-center justify-center group-data-[collapsible=icon]:flex";

/** Both header buttons are 28px square in the rail, per the design. */
const RAIL_BUTTON = "size-7!";

/**
 * The back row is a full-width 32px row while extended and a 28px square in the
 * rail, so its collapsed size is a variant rather than a flat override.
 */
const BACK_BUTTON = "group-data-[collapsible=icon]:size-7!";

/**
 * The sidebar has two views and the **route** decides which is showing:
 * `/settings` and anything beneath it render Settings, everything else renders
 * Portal. Deriving the view from the route rather than from component state is
 * what lets a settings URL survive a refresh, and it keeps the shell consistent
 * with ADR 0001's route-driven nav.
 *
 * Both views collapse to the same 48px icon rail.
 */
function AppSidebar({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const matchRoute = useMatchRoute();
  const inSettings = !!matchRoute({ to: SETTINGS_PATH, fuzzy: true });

  return (
    <Sidebar collapsible="icon">
      {inSettings ? <SettingsHeader /> : <PortalHeader />}

      <SidebarContent>{inSettings ? <SettingsNav /> : <PortalNav />}</SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Search and Documentation are parked: both rendered as ordinary
              enabled buttons with no handler, so clicking them did nothing at
              all — the worst of the three states, since they looked live.

              Search needs a cross-resource query endpoint; ADR 031's
              `POST /{resource}/query` exists only for projects today, so there
              is nothing to search across. Documentation needs a published URL
              for the docs site to point at. */}
          <UserMenuItem user={user} onSignOut={onSignOut} />
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/** Portal header: the full logo lockup, replaced by the toggle in the rail. */
function PortalHeader() {
  return (
    <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:p-0">
      <div className={RAIL_HEADER}>
        <SidebarTrigger className={RAIL_BUTTON} />
      </div>
      <Link
        to="/"
        aria-label="Home"
        className="inline-flex items-center text-sidebar-foreground group-data-[collapsible=icon]:hidden"
      >
        <ZitadelLogo aria-hidden />
      </Link>
    </SidebarHeader>
  );
}

/**
 * Settings header: the way back out of the view.
 *
 * D13 rules out back buttons and breadcrumbs console-wide, on the grounds that
 * you move back up via the left-side nav. This row *is* the left-side nav — it
 * switches the sidebar's view rather than walking a page hierarchy — so it is
 * read as the mechanism D13 endorses rather than an exception to it. Worth
 * confirming as a decision either way.
 */
function SettingsHeader() {
  return (
    <SidebarHeader className="group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0">
      <div className={RAIL_HEADER}>
        <SidebarTrigger className={RAIL_BUTTON} />
      </div>
      {/* One row, restyled per state — rendering a separate rail copy would put
          two "Back to app" links in the accessibility tree at once, with only
          CSS deciding which one is real. */}
      <SidebarMenu className="group-data-[collapsible=icon]:h-11 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center">
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Back to app" className={BACK_BUTTON}>
            <Link to="/">
              <ArrowLeft aria-hidden />
              <span>Back to app</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}

/**
 * The settings group heading — `Sidebar / SidebarGroupLabel` in the frames
 * (`1602:28329`): the overline face, 12px uppercase with 0.72px tracking. The
 * component's own defaults carry the rest (32px row, `sidebar-foreground`/70).
 */
const GROUP_LABEL = "font-serif tracking-[0.72px] uppercase";

/**
 * Settings nav — the grouped list the settings frames draw (`ACCOUNT` /
 * `WORKSPACE`, Figma `1568:97804`). Entries attach the same way Portal's do —
 * `staticData.nav` on the route — with `nav.section` naming the group.
 *
 * A group appears with its first built row and not before: a heading over
 * nothing advertises a section that is not there (the same argument that
 * removed the portal's disabled rows). `WORKSPACE / Members` is design-only
 * today — `GET /users/{id}/teams` now exists, so #735 no longer blocks it, but
 * the screen is unbuilt.
 */
function SettingsNav() {
  const groups = useSettingsNavItems();
  const matchRoute = useMatchRoute();

  return (
    <div role="navigation" aria-label="Settings">
      {groups.map(({ section, label, items }) => (
        <SidebarGroup key={section}>
          <SidebarGroupLabel className={GROUP_LABEL}>{label}</SidebarGroupLabel>
          <SidebarMenu className="gap-0 group-data-[collapsible=icon]:gap-1">
            {items.map((item) => {
              const Icon = item.nav.icon;
              return (
                <SidebarMenuItem key={item.nav.label}>
                  <SidebarMenuButton
                    asChild
                    isActive={!!matchRoute({ to: item.to, fuzzy: true })}
                    tooltip={item.nav.label}
                  >
                    <Link to={item.to} title={item.nav.label}>
                      {Icon && <Icon aria-hidden />}
                      <span>{item.nav.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </div>
  );
}

/** Portal nav: the flat list, with `User schemas` nested under `Users`. */
function PortalNav() {
  const items = useNavItems();
  const matchRoute = useMatchRoute();

  return (
    <SidebarGroup role="navigation" aria-label="Primary" className="py-0">
      <SidebarMenu className="gap-0 group-data-[collapsible=icon]:gap-1">
        {items.map((item) => {
          const Icon = item.nav.icon;
          const label = item.nav.label;
          if (!item.to) {
            return (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  tooltip={label}
                  className="cursor-default"
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
              <SidebarMenuButton asChild isActive={active} tooltip={label}>
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
  );
}

/**
 * The identity block: 32px avatar, name, email. It is drawn twice — as the
 * footer trigger and again as the dropdown's header — so it lives in one place.
 *
 * The gradient is the design's `Gradient/Red` style rather than a token: it is
 * a placeholder portrait, and no avatar image source exists on the session yet.
 */
function UserIdentity({ name, email }: { name: string; email?: string }) {
  return (
    <>
      <span
        aria-hidden
        className="size-8 shrink-0 rounded-full bg-[linear-gradient(232deg,#f25543_17%,#0f0f11_75%)]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
        <span className="truncate text-sm leading-none font-semibold">{name}</span>
        {email && <span className="truncate text-xs leading-none">{email}</span>}
      </span>
    </>
  );
}

/**
 * Footer account entry: the signed-in identity from `GET /sessions/me`
 * (name → email → user id fallback, per the API's identity-hydration contract),
 * opening the account dropdown (Console ADR 0003).
 *
 * The dropdown is the entry point to the Settings view — `Settings` navigates
 * to the route that switches the sidebar over. Console-local chrome by design:
 * the dark-only `<zitadel-session>` pair is not theme-portable yet (root
 * AGENTS.md bucket rule).
 *
 * Two details come from the design rather than from shadcn's defaults. The
 * container hairline resolves to `foreground/10`, not `border` — the two are
 * interchangeable on the light canvas and visibly are not on the dark one. And
 * the separators sit flush against the rows, so the default `-mx-1 my-1` comes
 * off.
 */
function UserMenuItem({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const displayName = user?.name ?? user?.email ?? user?.userId ?? "Signed in";
  // Show the email as the secondary line only when the name is the primary.
  const secondary = user?.name ? user.email : undefined;

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg" tooltip={displayName} aria-label={`Account: ${displayName}`}>
            <UserIdentity name={displayName} email={secondary} />
            <ChevronsUpDown className="ml-auto text-muted-foreground" aria-hidden />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56 border-foreground/10">
          <DropdownMenuLabel className="flex h-11 items-center gap-2 font-normal">
            <UserIdentity name={displayName} email={secondary} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="mx-px my-0" />
          <DropdownMenuItem asChild>
            <Link to={SETTINGS_PATH}>Settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-px my-0" />
          <DropdownMenuItem onSelect={() => onSignOut?.()} disabled={!onSignOut}>
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function ContextBar() {
  // While the sidebar is collapsed the rail carries the toggle in its header,
  // per the design. Rendering this one as well would put two on screen.
  const { state } = useSidebar();

  return (
    // 64px tall with its content centred, per the navbar every screen frame
    // draws. `pt-7` bottom-aligned a 40px row into 68px, which pushed every
    // page 4px down the screen.
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-background px-2 py-3 md:items-center md:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        {/* Desktop only — mobile keeps the persistent Sidebar 07. icon rail. */}
        {state === "expanded" && (
          <SidebarTrigger className="hidden text-foreground md:inline-flex" />
        )}
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
