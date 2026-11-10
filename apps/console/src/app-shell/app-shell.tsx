import { Link, useMatch, useMatchRoute } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
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
import { ZitadelLogo } from "./logo";
import { SearchDialog, SearchTrigger, useSearchShortcut } from "./search";
import { useNavItems } from "./use-nav-items";
import type { NavView } from "@/nav";
import { SETTINGS_PATH, type ShellUser, UserMenuItem } from "./user-menu";

/**
 * Console shell built on shadcn's `Sidebar` block. `collapsible="icon"` gives
 * the 256px → icon-rail collapse with tooltips, ⌘/Ctrl+B, mobile off-canvas, and
 * rail — all from the component. The sidebar's header carries the logo and the
 * collapse toggle, and search heads its list; the context bar (project and
 * team switchers) sits at the top of the content column. Colours come from `@zitadel/design-tokens` via the shadcn utility names;
 * the sidebar surface uses `background` per the design (see `ui/sidebar.tsx`).
 *
 * Every screen is drawn in this one frame (D27). What changes with where the
 * person is is the sidebar's list and what the project pill says
 * (`useShellView`), never the frame, so going from a project to Projects, and
 * from there into Settings, moves nothing but the list.
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
  const view = useShellView();
  const [searchOpen, setSearchOpen] = useSearchShortcut();

  return (
    <SidebarProvider defaultOpen={readSidebarOpen()}>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <AppSidebar
        view={view}
        user={user}
        onSignOut={onSignOut}
        onSearch={() => setSearchOpen(true)}
      />
      {/* `min-w-0` because the inset is a flex item, and a flex item's default
          `min-width: auto` makes it grow to fit its widest content instead of
          letting that content scroll. Without it a table wider than the viewport
          stretches the whole page and the window scrolls sideways, rather than
          the table scrolling inside its own card. */}
      <SidebarInset className="min-w-0">
        <ContextBar view={view} userId={user?.userId} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

/** The console's home: Projects, the list of every project. */
const HOME_ROUTE = "/_authed/projects/";

/**
 * Which of the sidebar's three lists is showing, and the **route** decides:
 * Projects is above every project, so it lists the account's screens;
 * `/settings` with anything beneath it lists Settings' pages (D29);
 * everything else lists the selected project's. Deriving it from the route
 * rather than from component state is what lets a settings URL survive a
 * refresh, and it keeps the shell consistent with ADR 0001's route-driven nav.
 */
function useShellView(): NavView {
  const matchRoute = useMatchRoute();
  const atHome = !!useMatch({ from: HOME_ROUTE, shouldThrow: false });
  if (matchRoute({ to: SETTINGS_PATH, fuzzy: true })) return "settings";
  return atHome ? "account" : "portal";
}

/** Home is Projects, the list of every project, from any screen. */
function HomeLink({ className }: { className: string }) {
  return (
    <Link to="/projects" aria-label="Home" className={`inline-flex items-center ${className}`}>
      <ZitadelLogo className="h-[21px] w-auto" />
    </Link>
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

/**
 * The sidebar: the brand header, search, the list `view` names, and the
 * account in the footer. Every list collapses to the same 48px icon rail.
 */
function AppSidebar({
  view,
  user,
  onSignOut,
  onSearch,
}: {
  view: NavView;
  user?: ShellUser;
  onSignOut?: () => void;
  onSearch: () => void;
}) {
  return (
    <Sidebar collapsible="icon">
      <BrandHeader />

      <SidebarContent>
        {/* Search heads the list, as Vercel's `Find` does: in the top bar it
            sat a row above a list's own search (D27). */}
        <SidebarGroup className="pt-4 pb-0">
          <SidebarMenu>
            <SearchTrigger onOpen={onSearch} />
          </SidebarMenu>
        </SidebarGroup>
        <NavList view={view} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {/* Documentation is parked: it needs a published URL for the docs
              site to point at, and a row that does nothing reads as broken. */}
          <UserMenuItem user={user} onSignOut={onSignOut} />
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/** Logo lockup, linking home, and the collapse toggle; the toggle alone in the rail. */
function BrandHeader() {
  return (
    <SidebarHeader className={BRAND_HEADER}>
      <HomeLink className="text-sidebar-foreground group-data-[collapsible=icon]:hidden" />
      <SidebarTrigger className={HEADER_BUTTON} />
    </SidebarHeader>
  );
}

/** What assistive tech calls each list. */
const NAV_LABEL: Record<NavView, string> = {
  portal: "Primary",
  account: "Account",
  settings: "Settings",
};

/**
 * The sidebar's nav: one flat list of the view's routes (`staticData.nav`,
 * Console ADR 0001). Portal is the project's screens. Account is what sits
 * above every project: Projects, the home, then what an add-on lists, then
 * Settings. Settings is that row's own list, under a heading that leads back:
 * the person's profile, alone while accounts are not surfaced (Console ADR
 * 0005 §3), then what an add-on lists. A row stays marked on the screens
 * beneath it, so a resource's detail keeps its list marked.
 *
 * Rows keep their height and a 2px gap in both sidebar states, so collapsing
 * moves nothing vertically.
 */
function NavList({ view }: { view: NavView }) {
  const items = useNavItems(view);
  const matchRoute = useMatchRoute();

  return (
    <SidebarGroup role="navigation" aria-label={NAV_LABEL[view]} className="pt-2 pb-0">
      <SidebarMenu className="gap-0.5">
        {view === "settings" && <SettingsHeading />}
        {items.map(({ to, nav: { icon: Icon, label: name } }) => (
          <SidebarMenuItem key={name}>
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
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * Heads the Settings list, as Vercel's does: the list's name, and the way
 * back up to the account's list (D29). It is a row of the left nav, which is
 * how the console moves up (D13), and it opens Projects, the account list's
 * first screen. In the icon rail it is the chevron alone.
 */
function SettingsHeading() {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Back to Projects" className="font-medium">
        {/* The name keeps the visible label and says where the row leads. */}
        <Link to="/projects" aria-label="Settings: back to Projects">
          <ChevronLeft aria-hidden />
          <span>Settings</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * The top bar: the project switcher, and the team switcher on a team's page.
 * 56px and ruled underneath, level with the sidebar's brand header. Search and
 * the collapse toggle live in the sidebar and the theme in the account menu,
 * so the bar carries none of them.
 */
function ContextBar({ view, userId }: { view: NavView; userId?: string }) {
  return (
    <div className={TOP_BAR}>
      {/* The signed-in person, whose recent projects the switcher keeps. */}
      {/* Above every project the pill says so, and its list leads into one. */}
      <ContextSwitcher userId={userId} allProjects={view !== "portal"} />
    </div>
  );
}

/** 56px, ruled underneath, level with the sidebar's brand header. */
const TOP_BAR =
  "sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-2 md:px-4";
