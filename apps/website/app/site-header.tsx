import { GitHubMark } from "./github-mark";
import { links } from "./links";
import { Logo } from "./logo";
import { PHASES, type PhaseSlug, phasePath } from "./phases";
import { ThemeToggle } from "./theme-toggle";

const NAV_LINK =
  "flex h-9 items-center rounded-xl px-3 text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary aria-[current=page]:text-text-primary";

// A phase's link under the bar, below a laptop's width.
const ROW_LINK =
  "flex h-8 shrink-0 items-center rounded-lg px-2.5 text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary aria-[current=page]:bg-tint/[0.08] aria-[current=page]:text-text-primary";

function PhaseLinks({ current, className }: { current?: string; className: string }) {
  return PHASES.map(({ slug, name }) => (
    <a
      key={slug}
      href={phasePath(slug)}
      aria-current={current === slug ? "page" : undefined}
      className={className}
    >
      {name}
    </a>
  ));
}

// The bar over the page: the logo, the preview's label, the four phases (from
// a laptop up), the theme, the changelog (from sm up; a phone has it in the
// footer), the docs and GitHub, on a plane of frosted glass that floats over
// the page as it scrolls. The header keeps its place (h-16), so the hero below
// keeps its measure. Below a laptop's width the phases take a row of their
// own under the bar, which scrolls away with the page (globals.css, .hero).
export function SiteHeader({ current }: { current?: "changelog" | PhaseSlug }) {
  return (
    <>
      <header className="sticky top-0 z-40 h-16 px-3 pt-3 sm:px-4">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-4 rounded-2xl border border-tint/10 bg-glass pr-1.5 pl-4 shadow-(--glass-shadow) backdrop-blur-xl backdrop-saturate-150">
          <div className="flex items-center gap-3">
            <a href="/" aria-label="Zitadel preview home" className="rounded-sm">
              <Logo id="header-logo" className="h-5 w-auto" autoplay />
            </a>
            <span className="rounded-full bg-tint/10 px-2 py-0.5 font-semibold text-[0.6875rem] text-text-secondary leading-4">
              Preview
            </span>
          </div>
          <nav aria-label="Phases" className="hidden items-center gap-0.5 text-sm lg:flex">
            <PhaseLinks current={current} className={NAV_LINK} />
          </nav>
          <nav aria-label="Main" className="flex items-center gap-0.5 text-sm">
            <ThemeToggle className={NAV_LINK} />
            <a
              href={links.changelog}
              aria-current={current === "changelog" ? "page" : undefined}
              className={`${NAV_LINK} max-sm:hidden`}
            >
              Changelog
            </a>
            <a href={links.docs} className={NAV_LINK}>
              Docs
            </a>
            <a href={links.github} aria-label="Zitadel on GitHub" className={NAV_LINK}>
              <GitHubMark className="size-[1.125rem]" />
            </a>
          </nav>
        </div>
      </header>
      {/* Centered while it fits, scrolled from its start once it does not. */}
      <nav aria-label="Phases" className="overflow-x-auto px-3 pt-2 text-[0.8125rem] lg:hidden">
        <div className="mx-auto flex w-max gap-0.5">
          <PhaseLinks current={current} className={ROW_LINK} />
        </div>
      </nav>
    </>
  );
}
