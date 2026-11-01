import type { Metadata } from "next";
import { LINK } from "./changelog/entry";
import { links } from "./links";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = { title: "Page not found — Zitadel preview" };

/**
 * A path nothing serves. The cloud sends the website every path no other
 * service claims (repo-root vercel.json), so a mistyped or stale address
 * lands here, as does a changelog entry that does not exist
 * (changelog/[slug]). ADR 076 §4 owns the anatomy and the copy.
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl">
          <p className="font-mono text-text-muted text-xs leading-4">Error 404</p>
          <h1 className="mt-3 font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            Page not found
          </h1>
          <p className="mt-4 text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            There is nothing at this address. The link may be broken, or the page may have moved.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-base">
            <a
              href="/"
              className="inline-flex h-11 items-center rounded-lg bg-text-primary px-5 font-semibold text-background text-sm transition-colors hover:opacity-85"
            >
              Go to the start page
            </a>
            <a href={links.docs} className={LINK}>
              Read the docs
            </a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
