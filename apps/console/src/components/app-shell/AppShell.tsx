import { Link } from "@tanstack/react-router";
import { ChevronUp, Monitor, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { type ThemePreference, useTheme } from "../../theme";
import { Tag } from "../tag";
import { ContextSwitcher } from "./ContextSwitcher";
import { ZitadelMark } from "./icons";
import { useNavItems } from "./use-nav-items";

const COLLAPSE_STORAGE_KEY = "zl-console-nav-collapsed";

/**
 * Console shell matching the Figma admin mock. The sidebar is a 72px icon rail by
 * default (xs–xl, as designed at `lg`) and expands to the full 264px list only at
 * `2xl`, where a `panel-left` toggle can collapse it back to the rail. The context
 * bar (org/project switchers + server icon + theme toggle) sits at the top of the
 * content column. Colours come from `@zitadel/design-tokens` via the `zl-*`
 * Tailwind theme and re-theme with `data-theme` (see apps/console/docs/styling.md).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed());

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore persistence failures */
    }
  }, [collapsed]);

  return (
    <div
      className="group/shell flex h-screen bg-zl-surface-base text-zl-text-primary"
      data-collapsed={collapsed}
    >
      <Sidebar collapsed={collapsed} onToggleCollapse={() => setCollapsed((value) => !value)} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <ContextBar />
        {children}
      </main>
    </div>
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// The sidebar is a rail everywhere except an un-collapsed 2xl viewport, gated on
// the `2xl:group-data-[collapsed=false]/shell:` variant. These class strings must
// be written out in full (no concatenation) so Tailwind's source scanner sees the
// complete candidate and emits the rule.
const SIDEBAR =
  "flex h-full w-[72px] shrink-0 flex-col justify-between border-r border-zl-border-subtle bg-zl-surface-base px-3 pb-6 pt-8 transition-[width,padding] 2xl:group-data-[collapsed=false]/shell:w-[264px] 2xl:group-data-[collapsed=false]/shell:px-6 2xl:group-data-[collapsed=false]/shell:pt-[46px]";
const RAIL_HIDE = "hidden 2xl:group-data-[collapsed=false]/shell:block";
const RAIL_CENTER = "justify-center 2xl:group-data-[collapsed=false]/shell:justify-start";

function Sidebar({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <nav id="console-sidebar" aria-label="Primary" className={SIDEBAR}>
      <div className="flex min-h-0 flex-1 flex-col gap-8">
        <div className="flex flex-col items-center gap-4 2xl:group-data-[collapsed=false]/shell:flex-row 2xl:group-data-[collapsed=false]/shell:justify-between 2xl:group-data-[collapsed=false]/shell:gap-0 2xl:group-data-[collapsed=false]/shell:px-2">

          <ZitadelMark size={22} className="text-zl-text-primary" aria-hidden />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-6 w-6 items-center justify-center rounded-zl-s text-zl-text-secondary hover:bg-zl-surface-subtle hover:text-zl-text-primary 2xl:inline-flex"
          >
            <PanelLeft size={16} />
          </button>
        </div>

        <SidebarNav />
      </div>

      <ProfileRow />
    </nav>
  );
}

const NAV_BASE =
  "flex h-10 items-center gap-3 rounded-md px-2 py-2 text-sm text-zl-text-secondary transition-colors";
const NAV_LINK = `${NAV_BASE} hover:bg-zl-surface-subtle hover:text-zl-text-primary ${RAIL_CENTER}`;
const NAV_LINK_ACTIVE = "bg-zl-surface-selected text-zl-text-primary";
const NAV_INERT = `${NAV_BASE} cursor-default ${RAIL_CENTER}`;

function SidebarNav() {
  const items = useNavItems();

  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {items.map((item) => {
        const Icon = item.nav.icon;
        const content = (
          <>
            <Icon size={16} className="shrink-0" aria-hidden />
            <span className={`flex-1 truncate ${RAIL_HIDE}`}>{item.nav.label}</span>
            {item.nav.count && (
              <span className={RAIL_HIDE}>
                <Tag tone="secondary">{item.nav.count}</Tag>
              </span>
            )}
          </>
        );
        return (
          <li key={item.nav.label}>
            {item.to ? (
              <Link
                to={item.to}
                className={NAV_LINK}
                activeProps={{ className: NAV_LINK_ACTIVE }}
                activeOptions={{ exact: item.to === "/" }}
                title={item.nav.label}
              >
                {content}
              </Link>
            ) : (
              <span
                className={NAV_INERT}
                aria-disabled="true"
                title={`${item.nav.label} — not available yet`}
              >
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ProfileRow() {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center rounded-full py-2 pl-1.5 pr-3 text-left hover:bg-zl-surface-subtle 2xl:group-data-[collapsed=false]/shell:justify-between"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zl-surface-subtle text-xs text-zl-text-primary"
        >
          F
        </span>
        <span className={`truncate text-sm text-zl-text-primary ${RAIL_HIDE}`}>flo@domain.com</span>
      </span>
      <ChevronUp size={14} className={`shrink-0 text-zl-text-tertiary ${RAIL_HIDE}`} aria-hidden />
    </button>
  );
}

const CONTENT_PADDING = "mx-auto w-full max-w-[120rem] px-6 lg:px-10 2xl:px-16";

function ContextBar() {
  return (
    <div className={`${CONTENT_PADDING} flex items-start justify-between gap-4 pt-8`}>
      <ContextSwitcher />
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <button
          type="button"
          aria-label="Search"
          className="inline-flex h-10 w-10 items-center justify-center rounded-zl-s text-zl-text-secondary hover:bg-zl-surface-subtle hover:text-zl-text-primary"
        >
          <Search size={16} />
        </button>
        <ThemeToggle />
      </div>
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
      className="inline-flex items-center gap-0.5 rounded-zl-s border border-zl-border-subtle p-0.5"
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
            className={`inline-flex h-7 w-7 items-center justify-center rounded-zl-xs ${
              active
                ? "bg-zl-surface-subtle text-zl-text-primary"
                : "text-zl-text-tertiary hover:text-zl-text-primary"
            }`}
          >
            <Icon size={15} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
