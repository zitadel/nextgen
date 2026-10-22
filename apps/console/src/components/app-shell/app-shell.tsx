import { Link, useMatchRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

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
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { ContextSwitcher } from "./context-switcher";
import { ZitadelLogo } from "./icons";
import { SearchDialog, SearchTrigger, useSearchShortcut } from "./search";
import { useNavItems } from "./use-nav-items";
import type { NavView } from "@/nav";
import { SETTINGS_PATH, type ShellUser, UserMenuItem } from "./user-menu";

/**
 * Console shell built on shadcn's `Sidebar` block. `collapsible="icon"` gives
 * the 256px → icon-rail collapse with tooltips, ⌘/Ctrl+B, mobile off-canvas, and
 * rail — all from the component. The sidebar's header carries the logo and the
 * collapse toggle; the context bar (project and team switchers, search)
 * sits at the top of the content column in the portal view, and is absent from
 * the Settings view, which the design draws without one. Colours come from `@zitadel/design-tokens` via the shadcn utility names;
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
  // The palette is the shell's, not the bar's: ⌘K opens it in the Settings
  // view too, which draws no bar.
  const [searchOpen, setSearchOpen] = useSearchShortcut();

  return (
    <SidebarProvider defaultOpen={readSidebarOpen()}>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <AppSidebar user={user} onSignOut={onSignOut} />
      {/* `min-w-0` because the inset is a flex item, and a flex item's default
          `min-width: auto` makes it grow to fit its widest content instead of
          letting that content scroll. Without it a table wider than the viewport
          stretches the whole page and the window scrolls sideways, rather than
          the table scrolling inside its own card. */}
      <SidebarInset className="min-w-0">
        {/* No context bar in the Settings view: the settings design draws none,
            and the switcher it carries is a *project* control that says nothing
            about an account screen. */}
        {!inSettings && <ContextBar onSearch={() => setSearchOpen(true)} />}
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
 * The sidebar's top band: the logo with the collapse toggle beside it, 56px
 * tall, level with the top bar. In the icon rail the logo goes and the toggle
 * centres — there is no room for both, and the toggle brings the logo back.
 */
const BRAND_HEADER =
  "h-14 shrink-0 flex-row items-center justify-between py-0 pr-3 pl-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0";

/** The design's `Sidebar / Header Button`: 28px square around a 16px glyph. */
const HEADER_BUTTON = "size-7! text-sidebar-foreground";

// The rule under the back row sits inside its 48px, so the bottom inset gives
// up the pixel the rule takes.
const SETTINGS_HEADER =
  "border-b border-border pb-[calc(--spacing(2)-1px)] group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0";

/**
 * The sidebar has two views and the **route** decides which is showing:
 * `/settings` and anything beneath it render Settings, everything else renders
 * Portal. Deriving the view from the route rather than from component state is
 * what lets a settings URL survive a refresh, and it keeps the shell consistent
 * with ADR 0001's route-driven nav.
 *
 * Both views share the brand header and collapse to the same 48px icon rail.
 */
function AppSidebar({ user, onSignOut }: { user?: ShellUser; onSignOut?: () => void }) {
  const matchRoute = useMatchRoute();
  const inSettings = !!matchRoute({ to: SETTINGS_PATH, fuzzy: true });

  return (
    <Sidebar collapsible="icon">
      <BrandHeader />
      {inSettings && <SettingsHeader />}

      <SidebarContent>
        {inSettings ? (
          <NavList view="settings" label="Account settings" />
        ) : (
          <NavList view="portal" label="Primary" />
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Documentation is parked: it needs a published URL for the docs
              site to point at, and a row that does nothing reads as broken.
              Search lives in the top bar. */}
          <UserMenuItem user={user} onSignOut={onSignOut} />
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/** Logo lockup and the collapse toggle; the toggle alone in the rail. */
function BrandHeader() {
  return (
    <SidebarHeader className={BRAND_HEADER}>
      <Link
        to="/"
        aria-label="Home"
        className="inline-flex items-center text-sidebar-foreground group-data-[collapsible=icon]:hidden"
      >
        <ZitadelLogo className="h-[21px] w-auto" />
      </Link>
      <SidebarTrigger className={HEADER_BUTTON} />
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
      {/* One row, restyled per state — rendering a separate rail copy would put
          two "Back to dashboard" links in the accessibility tree at once, with only
          CSS deciding which one is real. */}
      <SidebarMenu className="group-data-[collapsible=icon]:items-center">
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Back to dashboard">
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
 * Both sidebars' nav: one flat list of the view's routes (`staticData.nav`,
 * Console ADR 0001). Portal is the project's screens; Settings holds the
 * person's profile alone while accounts are not surfaced (Console ADR 0005
 * §3). A row stays marked on the screens beneath it, so a resource's detail
 * keeps its list marked. Design-only entries (`DESIGN_ONLY_NAV`, empty today)
 * render disabled.
 *
 * Rows keep their height and a 2px gap in both sidebar states, so collapsing
 * moves nothing vertically.
 */
function NavList({ view, label }: { view: NavView; label: string }) {
  const items = useNavItems(view);
  const matchRoute = useMatchRoute();

  return (
    <SidebarGroup role="navigation" aria-label={label} className="pt-4 pb-0">
      <SidebarMenu className="gap-0.5">
        {items.map(({ to, nav: { icon: Icon, label: name } }) => (
          <SidebarMenuItem key={name}>
            {to ? (
              <SidebarMenuButton
                asChild
                isActive={!!matchRoute({ to, fuzzy: to !== "/" })}
                tooltip={name}
              >
                <Link to={to} title={name}>
                  <Icon aria-hidden />
                  <span>{name}</span>
                </Link>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton
                tooltip={name}
                className="cursor-default"
                aria-disabled="true"
                title={`${name} — not available yet`}
                onClick={(event) => event.preventDefault()}
              >
                <Icon aria-hidden />
                <span>{name}</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The top bar: the project switcher (and the team switcher on a team's page)
 * on the left, search on the right. 56px and ruled underneath, level with the
 * sidebar's brand header. The collapse toggle lives in the sidebar and the
 * theme in the account menu, so the bar carries neither.
 */
function ContextBar({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-2 md:px-4">
      <ContextSwitcher />
      {/* Hidden on phones, as in the proposal: ⌘K still opens it, and the bar
          needs the width for the switchers. */}
      <div className="hidden w-75 justify-end sm:flex">
        <SearchTrigger onOpen={onSearch} />
      </div>
    </div>
  );
}
