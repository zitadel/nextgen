import { Link } from "@tanstack/react-router";
import { Icon } from "@zitadel/ui-react";
import { type ReactNode, useState } from "react";

import { useNavSections } from "./use-nav-items";

/**
 * Console app shell (issue #440): persistent left sidebar, top header, and a
 * routed main content area. The sidebar collapses on small screens behind a
 * toggle. Colours come from `@zitadel/design-tokens` via Tailwind theme
 * utilities (`*-zl-*`); see apps/console/docs/styling.md.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="group/shell flex h-screen flex-col" data-nav-open={navOpen}>
      <Header navOpen={navOpen} onToggleNav={() => setNavOpen((open) => !open)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar onNavigate={() => setNavOpen(false)} />
        <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </div>
    </div>
  );
}

function Header({ navOpen, onToggleNav }: { navOpen: boolean; onToggleNav: () => void }) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-zl-border-default-gray-100 bg-zl-surface-default-primary-gray px-6">
      <button
        type="button"
        className="flex h-9 w-9 cursor-pointer flex-col justify-center gap-1 rounded-lg border border-zl-border-default-gray-200 bg-transparent md:hidden"
        aria-label="Toggle navigation"
        aria-expanded={navOpen}
        aria-controls="console-sidebar"
        onClick={onToggleNav}
      >
        <span className="mx-auto block h-0.5 w-[18px] bg-zl-text-primary-white" />
        <span className="mx-auto block h-0.5 w-[18px] bg-zl-text-primary-white" />
        <span className="mx-auto block h-0.5 w-[18px] bg-zl-text-primary-white" />
      </button>
      <div className="text-base font-semibold">Zitadel Console</div>
      <div className="flex-1" />
      {/* User menu / auth lands later (issue #440 non-goal). */}
      <span
        className="inline-flex items-center gap-1.5 text-sm text-zl-text-secondary-gray"
        aria-disabled="true"
      >
        <Icon name="user" size="16" decorative />
        Account
      </span>
    </header>
  );
}

const NAV_LINK =
  "block rounded-lg px-3 py-2 text-sm text-zl-text-secondary-gray hover:bg-zl-surface-default-secondary-gray hover:text-zl-text-primary-white";
const NAV_LINK_ACTIVE =
  "bg-zl-surface-default-secondary-gray font-semibold text-zl-text-primary-white";

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const sections = useNavSections();

  return (
    <nav
      id="console-sidebar"
      aria-label="Primary"
      className="fixed bottom-0 left-0 top-14 z-20 flex w-60 -translate-x-full flex-col gap-5 overflow-y-auto border-r border-zl-border-default-gray-100 bg-zl-surface-default-primary-gray px-3 py-4 transition-transform group-data-[nav-open=true]/shell:translate-x-0 md:static md:top-auto md:z-auto md:translate-x-0"
    >
      {sections.map((section) => (
        <div key={section.group ?? "_top"}>
          {section.group && (
            <p className="mb-1.5 ml-2 text-xs font-semibold uppercase tracking-wider text-zl-text-secondary-gray">
              {section.group}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={NAV_LINK}
                  activeProps={{ className: NAV_LINK_ACTIVE }}
                  activeOptions={{ exact: item.to === "/" }}
                  onClick={onNavigate}
                >
                  {item.nav.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
