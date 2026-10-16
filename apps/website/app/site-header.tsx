import { links } from "./links";
import { Logo } from "./logo";

const NAV_LINK =
  "flex h-9 items-center rounded-md px-3 text-text-secondary transition-colors hover:text-text-primary";

// GitHub's mark, as Fumadocs draws it in the docs' header.
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// The bar over the page: the logo, the preview's label, the docs and GitHub.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-border-primary border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-3">
          <a href="/" aria-label="Zitadel preview home" className="rounded-sm">
            <Logo id="header-logo" className="h-6 w-auto" />
          </a>
          <span className="rounded-full border border-border-secondary px-2.5 py-0.5 font-semibold text-text-secondary text-xs leading-4">
            Preview
          </span>
        </div>
        <nav aria-label="Main" className="-mr-3 flex items-center text-sm">
          <a href={links.docs} className={NAV_LINK}>
            Docs
          </a>
          <a href={links.github} aria-label="Zitadel on GitHub" className={NAV_LINK}>
            <GitHubMark className="size-5" />
          </a>
        </nav>
      </div>
    </header>
  );
}
