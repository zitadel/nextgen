import { Link, useMatchRoute } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronsUpDown,
  Monitor,
  Moon,
  Search,
  Sun,
} from "lucide-react";
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
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={readSidebarOpen()}>
      <AppSidebar />
      <SidebarInset>
        <ContextBar />
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

function AppSidebar() {
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
                      asChild
                      tooltip={label}
                      className="font-serif"
                    >
                      <span
                        aria-disabled="true"
                        title={`${label} — not available yet`}
                        className="cursor-default"
                      >
                        <Icon aria-hidden />
                        <span>{label}</span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              }
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
                      <Icon aria-hidden />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="gap-2">
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
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Florian" className="font-serif">
              <span
                aria-hidden
                className="size-8 shrink-0 rounded-lg bg-[linear-gradient(232deg,#f25543_17%,#0f0f11_75%)]"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                <span className="truncate text-[14px] text-sidebar-foreground">Florian</span>
                <span className="truncate text-[12px] text-muted-foreground">flo@domain.com</span>
              </span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" aria-hidden />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
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

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5 sm:inline-flex"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
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
