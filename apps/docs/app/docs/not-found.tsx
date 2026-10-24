"use client";

import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import Link from "next/link";

/**
 * A docs path no page answers, inside the docs' own layout, so the sidebar
 * and the search stay at hand; app/not-found.tsx shows it without them for a
 * path no route matches. It has the anatomy every error page shares
 * (ADR 076): the status, a title, one sentence and the ways on.
 */
export default function NotFound() {
  const search = useSearchContext();
  return (
    <div className="flex min-h-[70vh] flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      {/* A client component exports no metadata; React hoists this into the head. */}
      <title>Page not found</title>
      <p className="font-mono text-fd-muted-foreground text-xs uppercase tracking-[0.08em]">
        Error 404
      </p>
      <h1 className="mt-3 text-balance font-heading text-3xl font-normal">Page not found</h1>
      <p className="mt-3 max-w-md text-pretty text-fd-muted-foreground">
        There is nothing at this address. The link may be broken, or the page may have moved.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {search.enabled && (
          <button
            type="button"
            className={buttonVariants({ variant: "primary" })}
            onClick={() => search.setOpenSearch(true)}
          >
            Search the docs
          </button>
        )}
        <Link href="/docs" className={buttonVariants({ variant: "secondary" })}>
          Go to the docs home
        </Link>
      </div>
    </div>
  );
}
