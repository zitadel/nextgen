import { Link, useMatchRoute } from "@tanstack/react-router";
// `BookOpen` / `Search` return with the parked footer items below.
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { ContextSwitcher } from "./context-switcher";
import { ZitadelLogo } from "./icons";
import { SearchDialog, SearchTrigger, useSearchShortcut } from "./search";
import { useNavItems } from "./use-nav-items";
import { SETTINGS_PATH, type ShellUser, UserMenuItem } from "./user-menu";

export type { ShellUser };

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
  "h-14 shrink-0 flex-row items-center justify-between py-0 pr-3 pl-6 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0";

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

/** Logo lockup and the collapse toggle; the toggle alone in the rail. */
function BrandHeader() {
  return (
    <SidebarHeader className={BRAND_HEADER}>
      <Link
        to="/"
        aria-label="Home"
        className="inline-flex items-center text-sidebar-foreground group-data-[collapsible=icon]:hidden"
      >
        <ZitadelLogo aria-hidden className="h-[21px] w-[89px]" />
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
 * Settings nav: one flat list, as Vercel's account view draws it. Settings
 * (the person's profile) is its only row while accounts are not surfaced
 * (Console ADR 0005 §3).
 *
 * Rows attach the same way Portal's do, through `staticData.nav` on the route,
 * and declare `view: "settings"` so they leave the primary list alone. Each
 * marks only its own page.
 */
function SettingsNav() {
  const items = useNavItems("settings");
  const matchRoute = useMatchRoute();

  return (
    <SidebarGroup role="navigation" aria-label="Account settings" className="pt-4 pb-0">
      <SidebarMenu className={NAV_MENU}>
        {items.map((item) => {
          const Icon = item.nav.icon;
          const label = item.nav.label;
          // Every settings row is a built route: `useNavItems` merges the
          // design-only entries into the portal list only.
          if (!item.to) return null;
          return (
            <SidebarMenuItem key={label}>
              <SidebarMenuButton asChild isActive={!!matchRoute({ to: item.to })} tooltip={label}>
                <Link to={item.to} activeOptions={{ exact: true }} title={label}>
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
}

/**
 * Both navs: a 2px gap between rows in both states. Rows keep their height on
 * the rail too (the back row is the rail's 32px square, as every row is), so
 * collapsing moves nothing vertically.
 */
const NAV_MENU = "gap-0.5";

/** Portal nav: the flat list, with `User schemas` nested under `Users`. */
function PortalNav() {
  const items = useNavItems();
  const matchRoute = useMatchRoute();

  return (
    <SidebarGroup role="navigation" aria-label="Primary" className="pt-4 pb-0">
      <SidebarMenu className={NAV_MENU}>
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
