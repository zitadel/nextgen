import type { CSSProperties } from "react";
import { GetStartedButton } from "./cta";
import { Disclosure } from "./disclosure";
import { GitHubMark } from "./github-mark";
import { links } from "./links";
import { Logo } from "./logo";
import { NAV, NAV_END, type NavEntry, type NavGroup } from "./nav";
import type { PhaseSlug } from "./phases";
import type { FeatureSlug } from "./platform";
import { ThemeToggle } from "./theme-toggle";

const NAV_LINK =
  "flex h-9 items-center rounded-xl px-3 text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary aria-[current=page]:text-text-primary";

// A menu's panel: a window raised under its button.
const PANEL =
  "absolute top-full z-50 mt-3 rounded-2xl border border-window-border bg-window p-2 text-left shadow-(--window-shadow)";

/**
 * A menu's group: `heading` over its pages, each counted when the group is
 * numbered; no heading where the menu's button already says it. The list
 * carries the heading as its name, which a screen reader reads once.
 */
function Group({
  group,
  heading,
  current,
}: {
  group: NavGroup;
  heading: string | null;
  current?: string;
}) {
  const List = group.numbered ? "ol" : "ul";
  return (
    <div className="flex flex-col gap-1">
      {heading && (
        <p
          aria-hidden="true"
          className="px-3 pt-2 pb-1 font-mono text-text-muted text-xs leading-4"
        >
          {heading}
        </p>
      )}
      <List aria-label={heading ?? group.heading} className="flex flex-col">
        {group.entries.map((entry, index) => (
          <li key={entry.href}>
            <a
              href={entry.href}
              aria-current={current !== undefined && entry.id === current ? "page" : undefined}
              className="flex gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-tint/[0.05] aria-[current=page]:bg-tint/[0.06]"
            >
              {group.numbered && (
                <span
                  aria-hidden="true"
                  className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-window-border font-mono text-[0.625rem] text-text-secondary"
                >
                  {index + 1}
                </span>
              )}
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-sm text-text-primary leading-5">
                  {entry.label}
                </span>
                {entry.line && (
                  <span className="text-text-secondary text-xs leading-5">{entry.line}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </List>
    </div>
  );
}

/** The page that lists a whole menu, at the menu's foot under a hairline. */
function Overview({ entry, current }: { entry: NavEntry; current?: string }) {
  return (
    <div className="border-window-border border-t pt-2">
      <a
        href={entry.href}
        aria-current={current !== undefined && entry.id === current ? "page" : undefined}
        className="group flex items-center justify-between rounded-xl px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-tint/[0.05] hover:text-text-primary aria-[current=page]:text-text-primary"
      >
        {entry.label}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="size-4 transition-transform group-hover:translate-x-0.5"
        >
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="size-3.5 transition-transform group-aria-expanded:rotate-180"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Three lines while the phone's menu is closed, a cross while it is open. */
function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="size-[1.125rem]"
    >
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" className="group-aria-expanded:hidden" />
      <path d="M4 4l8 8M12 4l-8 8" className="hidden group-aria-expanded:block" />
    </svg>
  );
}

// The bar over the page, on a plane of frosted glass that floats over the
// page as it scrolls: the logo, the preview's label (from 360px up, where the
// bar has room for it beside the button and the menu) and, from a laptop up,
// the top level of app/nav.ts on the left; the theme (from sm up), GitHub
// (from md up), nav.ts's links for the right (from a laptop up) and the one
// primary button on the right. Below a laptop one menu holds the top level:
// every menu's groups under their headings and the page that lists them,
// then all the links. The header keeps its place (h-16).
export function SiteHeader({
  current,
}: {
  current?: "changelog" | "platform" | PhaseSlug | FeatureSlug;
}) {
  const menus = NAV.flatMap((item) => (item.kind === "menu" ? [item] : []));
  const navLinks = [...NAV.flatMap((item) => (item.kind === "link" ? [item] : [])), ...NAV_END];
  return (
    <header className="sticky top-0 z-40 h-16 px-3 pt-3 sm:px-4">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-4 rounded-2xl border border-tint/10 bg-glass pr-1.5 pl-4 shadow-(--glass-shadow) backdrop-blur-xl backdrop-saturate-150">
        <div className="flex items-center gap-3">
          <a href="/" aria-label="Zitadel preview home" className="rounded-sm">
            <Logo id="header-logo" className="h-5 w-auto" autoplay />
          </a>
          <span className="rounded-full bg-tint/10 px-2 py-0.5 font-semibold text-[0.6875rem] text-text-secondary leading-4 max-[22.5rem]:hidden">
            Preview
          </span>
          <nav aria-label="Main" className="ml-3 hidden items-center gap-0.5 text-sm lg:flex">
            {NAV.map((item) =>
              item.kind === "link" ? (
                <a
                  key={item.label}
                  href={item.href}
                  aria-current={current !== undefined && item.id === current ? "page" : undefined}
                  className={NAV_LINK}
                >
                  {item.label}
                </a>
              ) : (
                <Disclosure
                  key={item.label}
                  label={
                    <>
                      {item.label}
                      <Chevron />
                    </>
                  }
                  buttonClassName={`group gap-1 ${NAV_LINK}`}
                  panelClassName={`${PANEL} left-0`}
                >
                  {/* A column per group, so another group sits beside it; on
                      a laptop at most two, the rest under them, so a wide
                      menu stays on screen. */}
                  <div
                    style={
                      {
                        "--cols": item.groups.length,
                        "--cols-lg": Math.min(item.groups.length, 2),
                      } as CSSProperties
                    }
                    className="grid grid-cols-[repeat(var(--cols-lg),17.5rem)] gap-2 xl:grid-cols-[repeat(var(--cols),17.5rem)]"
                  >
                    {item.groups.map((group) => (
                      <Group
                        key={group.heading}
                        group={group}
                        heading={group.heading === item.label ? null : group.heading}
                        current={current}
                      />
                    ))}
                  </div>
                  {item.overview && (
                    <div className="mt-2">
                      <Overview entry={item.overview} current={current} />
                    </div>
                  )}
                </Disclosure>
              ),
            )}
          </nav>
        </div>
        <div className="flex items-center gap-0.5 text-sm">
          <ThemeToggle className={`${NAV_LINK} max-sm:hidden`} />
          <a
            href={links.github}
            aria-label="Zitadel on GitHub"
            className={`${NAV_LINK} max-md:hidden`}
          >
            <GitHubMark className="size-[1.125rem]" />
          </a>
          {NAV_END.map((item) => (
            <a key={item.label} href={item.href} className={`${NAV_LINK} max-lg:hidden`}>
              {item.label}
            </a>
          ))}
          <GetStartedButton />
          <nav aria-label="Main" className="lg:hidden">
            <Disclosure
              label={
                <>
                  <MenuIcon />
                  <span className="sr-only">Menu</span>
                </>
              }
              buttonClassName={`group ${NAV_LINK}`}
              panelClassName={`${PANEL} right-0 w-[calc(100vw-2.25rem)] max-w-[24rem]`}
            >
              <div className="flex max-h-[calc(100svh-5.5rem)] flex-col gap-2 overflow-y-auto">
                {/* A phone's headings name the menu too, where a group's own
                    does not. */}
                {menus.map((menu) => (
                  <div key={menu.label} className="flex flex-col gap-2">
                    {menu.groups.map((group) => (
                      <Group
                        key={group.heading}
                        group={group}
                        heading={
                          group.heading === menu.label
                            ? group.heading
                            : `${menu.label} · ${group.heading}`
                        }
                        current={current}
                      />
                    ))}
                    {menu.overview && <Overview entry={menu.overview} current={current} />}
                  </div>
                ))}
                <ul className="flex flex-col border-window-border border-t pt-2">
                  {navLinks.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        aria-current={
                          current !== undefined && item.id === current ? "page" : undefined
                        }
                        className="flex h-10 items-center rounded-xl px-3 text-sm text-text-secondary transition-colors hover:bg-tint/[0.05] hover:text-text-primary aria-[current=page]:text-text-primary"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </Disclosure>
          </nav>
        </div>
      </div>
    </header>
  );
}
