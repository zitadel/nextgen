import { Link, useMatch, useMatchRoute } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useState } from "react";

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

import { LogFilters, LogViewRows } from "@/features/events/components/logs-nav";

import { ContextSwitcher } from "./context-switcher";
import { ZitadelLogo } from "./logo";
import { SearchDialog, SearchTrigger, useSearchShortcut } from "./search";
import { useNavItems } from "./use-nav-items";
import { cn } from "@/lib/utils";
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
 * from there into Settings, moves nothing but the list. Opening a list from a
 * row of another slides it in from the right, and the way back from the left
 * (`useListEntrance`).
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

/** Logs, whose list replaces the project's on the screen and on an event's page. */
const LOGS_PATH = "/events";

/**
 * Which of the sidebar's lists is showing, and the **route** decides:
 * Projects is above every project, so it lists the account's screens;
 * `/settings` with anything beneath it lists Settings' pages (D29); `/events`
 * with anything beneath it lists Logs' views and filters (D30); everything
 * else lists the selected project's. Deriving it from the route rather than
 * from component state is what lets a settings or logs URL survive a refresh,
 * and it keeps the shell consistent with ADR 0001's route-driven nav.
 */
function useShellView(): NavView {
  const matchRoute = useMatchRoute();
  const atHome = !!useMatch({ from: HOME_ROUTE, shouldThrow: false });
  if (matchRoute({ to: SETTINGS_PATH, fuzzy: true })) return "settings";
  if (matchRoute({ to: LOGS_PATH, fuzzy: true })) return "logs";
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

      {/* Clips sideways so a list sliding in never draws a scrollbar. */}
      <SidebarContent className="overflow-x-hidden">
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
  logs: "Logs",
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
 * Logs is one screen's own list, under a heading that leads back to the
 * project's: its rows are the list's views, not routes, and its filters
 * follow them in a group of their own (D30). The events feature draws both.
 *
 * Rows keep their height and a 2px gap in both sidebar states, so collapsing
 * moves nothing vertically.
 */
function NavList({ view }: { view: NavView }) {
  const items = useNavItems(view);
  const matchRoute = useMatchRoute();
  const entrance = useListEntrance(view);

  return (
    // Keyed by the list, so a new one mounts and plays its entrance once.
    <div key={view} className={cn("flex flex-col gap-2", entrance)}>
      <SidebarGroup role="navigation" aria-label={NAV_LABEL[view]} className="pt-2 pb-0">
        <SidebarMenu className="gap-0.5">
          {/* Projects is the account list's first screen. */}
          {view === "settings" && <ListHeading name="Settings" to="/projects" back="Projects" />}
          {/* `/` is where a project lands, whichever screen that is. */}
          {view === "logs" && <ListHeading name="Logs" to="/" back="the project" />}
          {view === "logs" && <LogViewRows />}
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
      {view === "logs" && <LogFilters />}
    </div>
  );
}

/**
 * How deep each list sits: Projects' and a project's are where the console
 * starts; Settings' and Logs' open from a row of one (D29, D30).
 */
const LIST_DEPTH: Record<NavView, number> = { portal: 0, account: 0, settings: 1, logs: 1 };

/** A short fade and slide, with the design's motion tokens; none for reduced motion. */
const LIST_MOTION =
  "animate-in fade-in-0 duration-(--zl-duration-base) ease-(--zl-easing-decelerate) motion-reduce:animate-none";

/**
 * The entrance of the list `view` names, as Vercel's sidebar plays it: in from
 * the right going down into a list, in from the left on the way back up, so
 * the person sees which way they went. The first list drawn and a swap between
 * two at one depth (a project's and Projects') stay still. The view it last
 * saw is state, adjusted while rendering, so the class is there on the new
 * list's first paint.
 */
function useListEntrance(view: NavView): string | undefined {
  const [shown, setShown] = useState(view);
  const [entrance, setEntrance] = useState<string>();
  if (view !== shown) {
    const step = LIST_DEPTH[view] - LIST_DEPTH[shown];
    setShown(view);
    setEntrance(
      step > 0
        ? `${LIST_MOTION} slide-in-from-right-4`
        : step < 0
          ? `${LIST_MOTION} slide-in-from-left-4`
          : undefined,
    );
  }
  return entrance;
}

/**
 * Heads a list that a row of another list opened, as Vercel's does: the
 * list's name, and the way back up to the list it came from (D29, D30). It is
 * a row of the left nav, which is how the console moves up (D13). In the icon
 * rail it is the chevron alone.
 */
function ListHeading({
  name,
  to,
  back,
}: {
  name: string;
  to: "/projects" | "/";
  /** Where the row leads, as a sentence ends: "Back to Projects". */
  back: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={`Back to ${back}`} className="font-medium">
        {/* The name keeps the visible label and says where the row leads. */}
        <Link to={to} aria-label={`${name}: back to ${back}`}>
          <ChevronLeft aria-hidden />
          <span>{name}</span>
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
      {/* Above every project the pill says so, and its list leads into one.
          Logs is inside a project, like the project's own list. */}
      <ContextSwitcher userId={userId} allProjects={view === "account" || view === "settings"} />
    </div>
  );
}

/** 56px, ruled underneath, level with the sidebar's brand header. */
const TOP_BAR =
  "sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-2 md:px-4";
