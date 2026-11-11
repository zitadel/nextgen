import { Link, useMatch, useMatchRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

import { EventFilters, EventViewPicker } from "@/features/events/components/events-nav";

import { ContextSwitcher } from "./context-switcher";
import { ZitadelLogo } from "./logo";
import { SearchDialog, SearchTrigger, useSearchShortcut } from "./search";
import {
  PROJECT_SETTINGS_PATH,
  accountListItems,
  useNavItems,
  useRequestedNavItem,
} from "./use-nav-items";
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
 * person is is the sidebar's list (`useShellView`), never the frame or the
 * selected project (D36), so going from a project to Projects, and from there
 * into Settings, moves nothing but the list. Both Settings rows open a list of
 * their own: Projects' the root settings, a project's that project's (D40).
 * Opening a list from a row of another slides it in from the right, and the
 * way back from the left (`useListEntrance`).
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
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        userId={user?.userId}
        allProjects={view === "account" || view === "settings"}
      />
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

/** The person's profile, which the account menu opens (D41). */
const ACCOUNT_ROUTE = "/_authed/account/";

/** Events, whose list replaces the project's on the screen and under an event's drawer. */
const EVENTS_PATH = "/events";

/**
 * Which of the sidebar's lists is showing, and the **route** decides:
 * Projects is above every project, so it lists the account's screens, and
 * so does the person's profile (`/account`, D41);
 * `/settings` with anything beneath it lists Settings' pages (D29); `/project`
 * with anything beneath it lists the selected project's Settings pages (D40);
 * `/events` with anything beneath it lists Events' views and filters (D30);
 * everything else lists the selected project's. Deriving it from the route
 * rather than from component state is what lets a settings or events URL
 * survive a refresh, and it keeps the shell consistent with ADR 0001's
 * route-driven nav.
 */
function useShellView(): NavView {
  const matchRoute = useMatchRoute();
  const atHome = !!useMatch({ from: HOME_ROUTE, shouldThrow: false });
  // The person's profile is above every project too (D41), with no row of its own.
  const atAccount = !!useMatch({ from: ACCOUNT_ROUTE, shouldThrow: false });
  if (matchRoute({ to: SETTINGS_PATH, fuzzy: true })) return "settings";
  if (matchRoute({ to: PROJECT_SETTINGS_PATH, fuzzy: true })) return "project-settings";
  if (matchRoute({ to: EVENTS_PATH, fuzzy: true })) return "events";
  return atHome || atAccount ? "account" : "portal";
}

/**
 * Home is Projects, the list of every project, from any screen. The selected
 * project rides along (`_authed` retains `?project=`) and stays selected there
 * (D36).
 */
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
 * tall, level with the top bar. The logo starts 20px in, on the rows' glyphs.
 * In the icon rail the logo goes and the toggle centres — there is no room for
 * both, and the toggle brings the logo back.
 */
const BRAND_HEADER =
  "h-14 shrink-0 flex-row items-center justify-between py-0 pr-3 pl-5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0";

/** The design's `Sidebar / Header Button`: 28px square around a 16px glyph. */
const HEADER_BUTTON = "size-7! text-sidebar-foreground";

/**
 * The sidebar: the brand header, search, the list `view` names, and the
 * account in the footer. Every list collapses to the same 56px icon rail.
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
  "project-settings": "Project settings",
  events: "Events",
};

/**
 * The sidebar's nav: one flat list of the view's routes (`staticData.nav`,
 * Console ADR 0001). Portal is the project's screens. Account is what sits
 * above every project: Projects, the home, then the project's screens, then
 * what an add-on lists, then Settings (D34). A project's screen chosen from it
 * opens in the selected project (D36); with none selected it asks for one
 * (D31), marking its row while it asks (D22).
 * Settings is that row's own list, under a heading that leads back:
 * the person's profile, alone while accounts are not surfaced (Console ADR
 * 0005 §3), then what an add-on lists. A row stays marked on the screens
 * beneath it, so a resource's detail keeps its list marked. The project's
 * Settings row opens a list the same way, under a heading that leads back to
 * the project: its General and Admins pages (D40).
 *
 * Events is one screen's own list, under a heading that leads back to the
 * project's: a picker of the list's views, not routes, and its filters in a
 * group of their own (D30). The events feature draws both.
 *
 * Rows are Vercel's: 36px with a 1px gap, the glyph 12px in and the label 10px
 * after it. They keep that height in the rail, so collapsing moves nothing
 * vertically.
 */
function NavList({ view }: { view: NavView }) {
  const own = useNavItems(view);
  const project = useNavItems("portal");
  const settings = useNavItems("settings");
  const items = view === "account" ? accountListItems(own, project, settings) : own;
  // On Projects' way to a screen (`?next=`), that screen's row is the marked one.
  const requested = useRequestedNavItem(project);
  const matchRoute = useMatchRoute();
  const entrance = useListEntrance(view);

  return (
    // Keyed by the list, so a new one mounts and plays its entrance once.
    <div key={view} className={cn("flex flex-col gap-2", entrance)}>
      <SidebarGroup role="navigation" aria-label={NAV_LABEL[view]} className="pt-2 pb-0">
        <SidebarMenu className="gap-px">
          {/* Projects is the account list's first screen. */}
          {view === "settings" && <ListHeading name="Settings" to="/projects" back="Projects" />}
          {view === "project-settings" && <ListHeading name="Settings" to="/" back="the project" />}
          {/* `/` is where a project lands, whichever screen that is. */}
          {view === "events" && <ListHeading name="Events" to="/" back="the project" />}
          {view === "events" && <EventViewPicker />}
          {items.map(({ to, nav: { icon: Icon, label: name } }) => (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                asChild
                isActive={requested ? requested.to === to : !!matchRoute({ to, fuzzy: to !== "/" })}
                tooltip={name}
              >
                <Link to={to} title={name}>
                  <Icon aria-hidden />
                  {/* Cut short itself: with the arrow after it, it is no
                      longer the button's last child, which is what the
                      button truncates. */}
                  <span className="truncate">{name}</span>
                  {opensList(view, to) && (
                    // The account row's arrow in the footer, which opens a menu
                    // as this row opens a list. Not drawn in the rail.
                    <ChevronRight
                      aria-hidden
                      data-opens-list
                      className="text-sidebar-foreground ml-auto group-data-[collapsible=icon]:hidden"
                    />
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
      {view === "events" && <EventFilters />}
    </div>
  );
}

/**
 * How deep each list sits: Projects' and a project's are where the console
 * starts; both Settings' and Events' open from a row of one (D29, D30, D40).
 */
const LIST_DEPTH: Record<NavView, number> = {
  portal: 0,
  account: 0,
  settings: 1,
  "project-settings": 1,
  events: 1,
};

/** The list a row's screen shows, where it is not the project's or the account's. */
function listOf(to: string): NavView | undefined {
  const under = (path: string) => to === path || to.startsWith(`${path}/`);
  if (under(SETTINGS_PATH)) return "settings";
  if (under(PROJECT_SETTINGS_PATH)) return "project-settings";
  if (under(EVENTS_PATH)) return "events";
  return undefined;
}

/**
 * Whether a row of the list `view` names swaps the sidebar for a list one
 * level down (Events and Settings in a project's list, Settings in the
 * account's), rather than opening a screen beside it. Such a row carries an
 * arrow, so the swap is no surprise. A row of the list it is already in (Settings' Profile) does
 * not: the rule is the depth, so a new list needs no change here.
 */
function opensList(view: NavView, to: string): boolean {
  const target = listOf(to);
  return target !== undefined && LIST_DEPTH[target] > LIST_DEPTH[view];
}

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
      {/* Above every project, with none selected, the pill says so, and its
          list leads into one. */}
      <ContextSwitcher userId={userId} allProjects={view === "account" || view === "settings"} />
    </div>
  );
}

/** 56px, ruled underneath, level with the sidebar's brand header. */
const TOP_BAR =
  "sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-2 md:px-4";
