import { Link, useMatchRoute } from "@tanstack/react-router";
// `BookOpen` / `Search` return with the parked footer items below.
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

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
import type { NavGroup } from "@/nav";

import { ContextSwitcher } from "./context-switcher";
import { ZitadelLogo } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { useNavItems } from "./use-nav-items";
import { SETTINGS_PATH, type ShellUser, UserMenuItem } from "./user-menu";

export type { ShellUser };

/**
 * Console shell built on shadcn's `Sidebar` block. `collapsible="icon"` gives
 * the 256px → icon-rail collapse with tooltips, ⌘/Ctrl+B, mobile off-canvas, and
 * rail — all from the component. The context bar (sidebar trigger, project
 * switcher, theme toggle) sits at the top of the content column in the portal
 * view, and is absent from the Settings view, which the design draws without
 * one. Colours come from `@zitadel/design-tokens` via the shadcn utility names;
 * the sidebar surface uses `background` per the design (see `ui/sidebar.tsx`).
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
  const matchRoute = useMatchRoute();
  const inSettings = !!matchRoute({ to: SETTINGS_PATH, fuzzy: true });

  return (
    <SidebarProvider defaultOpen={readSidebarOpen()}>
      <AppSidebar user={user} onSignOut={onSignOut} />
      {/* `min-w-0` because the inset is a flex item, and a flex item's default
          `min-width: auto` makes it grow to fit its widest content instead of
          letting that content scroll. Without it a table wider than the viewport
          stretches the whole page and the window scrolls sideways, rather than
          the table scrolling inside its own card. */}
      <SidebarInset className="min-w-0">
        {/* No context bar in the Settings view: the settings design draws none,
            and the switcher it carries is a *project* control that says nothing
            about an account screen. The sidebar's own header keeps a trigger, so
            collapsing still works without it. */}
        {!inSettings && <ContextBar />}
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

/** Restore the collapse state shadcn persists in the `sidebar_state` cookie. */
function readSidebarOpen(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

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

// The rule under the header sits inside its 48px, so the bottom inset gives
// up the pixel the rule takes.
const SETTINGS_HEADER =
  "border-b border-border pb-[calc(--spacing(2)-1px)] group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0";

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
    <SidebarHeader className={SETTINGS_HEADER}>
      <div className={RAIL_HEADER}>
        <SidebarTrigger className={RAIL_BUTTON} />
      </div>
      {/* One row, restyled per state — rendering a separate rail copy would put
          two "Back to dashboard" links in the accessibility tree at once, with only
          CSS deciding which one is real. */}
      <SidebarMenu className="group-data-[collapsible=icon]:h-11 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center">
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Back to dashboard" className={BACK_BUTTON}>
            <Link to="/">
              <ArrowLeft aria-hidden />
              <span>Back to dashboard</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}

/**
 * Settings nav: the design's grouped list, `ACCOUNT` over `WORKSPACE`.
 *
 * Rows attach the same way Portal's do, through `staticData.nav` on the route,
 * and declare `view: "settings"` so they leave the primary list alone.
 *
 * A heading renders only when a route claims it. Profile claims `ACCOUNT`.
 * No screen claims `WORKSPACE` yet, so that heading is absent rather than a
 * heading over nothing.
 */
function SettingsNav() {
  const items = useNavItems("settings");
  const matchRoute = useMatchRoute();

  return (
    <>
      {SETTINGS_GROUPS.map((group) => {
        const rows = items.filter((item) => item.nav.group === group);
        if (rows.length === 0) return null;
        return (
          <SidebarGroup key={group} role="navigation" aria-label={group}>
            <SidebarGroupLabel>{group}</SidebarGroupLabel>
            <SidebarMenu className="gap-0 group-data-[collapsible=icon]:gap-1">
              {rows.map((item) => {
                const Icon = item.nav.icon;
                const label = item.nav.label;
                // Every settings row is a built route: `useNavItems` merges the
                // design-only entries into the portal list only.
                if (!item.to) return null;
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      asChild
                      isActive={!!matchRoute({ to: item.to, fuzzy: true })}
                      tooltip={label}
                    >
                      <Link to={item.to} title={label}>
                        {Icon && <Icon aria-hidden />}
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        );
      })}
    </>
  );
}

/** Heading order in the Settings nav, top to bottom, as the design draws it. */
const SETTINGS_GROUPS: NavGroup[] = ["ACCOUNT", "WORKSPACE"];

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

function ContextBar() {
  // While the sidebar is collapsed the rail carries the toggle in its header,
  // per the design. Rendering this one as well would put two on screen.
  const { state } = useSidebar();

  return (
    // 64px tall with its content centred, per the navbar every screen draws.
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-background px-2 py-3 md:items-center md:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        {/* Desktop only — mobile keeps the persistent icon rail. */}
        {state === "expanded" && (
          <SidebarTrigger className="hidden text-foreground md:inline-flex" />
        )}
        <ContextSwitcher />
      </div>
      <ThemeToggle />
    </div>
  );
}
