import { GitHubMark } from "./github-mark";
import { links } from "./links";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const NAV_LINK =
  "flex h-9 items-center rounded-xl px-3 text-text-secondary transition-colors hover:bg-tint/[0.06] hover:text-text-primary";

// The bar over the page: the logo, the preview's label, the theme, the docs
// and GitHub,
// on a plane of frosted glass that floats over the page as it scrolls. The
// header keeps its place (h-16), so the hero below keeps its measure.
export function SiteHeader() {
  return (
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
        <nav aria-label="Main" className="flex items-center gap-0.5 text-sm">
          <ThemeToggle className={NAV_LINK} />
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
