"use client";

import Link from "fumadocs-core/link";
import { useTheme } from "fumadocs-ui/provider/base";
import { useSyncExternalStore } from "react";

import { Logo } from "@/components/logo";
import { docsRoute, gitConfig } from "@/lib/shared";

// The website's bar (apps/website/app/site-header.tsx) over the docs, in the
// docs' colours and on the page panel's geometry: inset by its margin, its
// corners, border and shadow. Fumadocs' layouts make room for whatever sets
// --fd-banner-height, as its Banner does.
const HEIGHT = "3.5rem";

const NAV_LINK =
  "flex h-9 items-center rounded-xl px-3 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground aria-[current=page]:text-fd-foreground";

const noop = () => () => {};

/** The website's quick flip between the page's sides, through Fumadocs' theme. */
function ThemeToggle({ className }: { className: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // The server cannot know the theme, so the first render shows dark, as the
  // website's toggle does.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const light = mounted && resolvedTheme === "light";
  return (
    <button
      type="button"
      aria-label="Light mode"
      aria-pressed={light}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      onClick={() => setTheme(light ? "dark" : "light")}
      className={`cursor-pointer ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        {light ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
          </>
        ) : (
          <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" />
        )}
      </svg>
    </button>
  );
}

// GitHub's mark, as the website's bar draws it (apps/website/app/github-mark.tsx).
function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-[1.125rem]">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// The logo, the preview's label, the theme, the changelog, the docs and
// GitHub. A phone has no room for every link, and the docs are where it is.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-fd-card px-2 pt-2" style={{ height: HEIGHT }}>
      <style>{`:root { --fd-banner-height: ${HEIGHT}; }`}</style>
      <div className="flex h-12 items-center justify-between gap-4 rounded-2xl border bg-fd-background pr-1.5 pl-4 shadow-sm">
        <div className="flex items-center gap-3">
          <a href="/" aria-label="Zitadel preview home" className="rounded-sm">
            <Logo id="site-header-logo" className="h-5 w-auto" autoplay />
          </a>
          <span className="rounded-full bg-fd-muted px-2 py-0.5 font-semibold text-[0.6875rem] text-fd-muted-foreground leading-4">
            Preview
          </span>
        </div>
        <nav aria-label="Main" className="flex items-center gap-0.5 text-sm">
          <ThemeToggle className={NAV_LINK} />
          <a href="/changelog" className={NAV_LINK}>
            Changelog
          </a>
          <Link href={docsRoute} aria-current="page" className={`${NAV_LINK} max-sm:hidden`}>
            Docs
          </Link>
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            aria-label="Zitadel on GitHub"
            className={NAV_LINK}
          >
            <GitHubMark />
          </a>
        </nav>
      </div>
    </header>
  );
}
