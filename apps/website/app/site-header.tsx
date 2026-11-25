import { GitHubMark } from "./github-mark";
import { links } from "./links";
import { LOGO_SIZE, Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const NAV_LINK =
  "flex h-9 items-center rounded-xl px-2.5 text-text-secondary sm:px-3 transition-colors hover:bg-tint/[0.06] hover:text-text-primary aria-[current=page]:text-text-primary";

// The bar over the page: the logo, the preview's label, the theme and the
// changelog (from sm up; a phone has both in the footer), the docs and GitHub,
// on a plane of frosted glass that floats over the page as it scrolls. The
// header keeps its place (h-18), so the hero below keeps its measure; its
// plane is tall enough for the logo at the guide's smallest (logo.tsx).
export function SiteHeader({ current }: { current?: "changelog" }) {
  return (
    <header className="sticky top-0 z-40 h-18 px-3 pt-3 sm:px-4">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 rounded-2xl border border-tint/10 bg-glass pr-1.5 pl-4 shadow-(--glass-shadow) backdrop-blur-xl backdrop-saturate-150 sm:gap-4 sm:pl-5">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <a href="/" aria-label="Zitadel preview home" className="rounded-sm">
            <Logo id="header-logo" className={LOGO_SIZE} autoplay />
          </a>
          <span className="tag rounded-full bg-tint/10 px-2 py-0.5 text-text-secondary text-xs leading-4">
            Preview
          </span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-0.5 text-sm">
          <ThemeToggle className={`${NAV_LINK} max-sm:hidden`} />
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
  );
}
