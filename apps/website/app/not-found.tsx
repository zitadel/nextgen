import type { Metadata } from "next";
import { BUTTON } from "./cta";
import { links } from "./links";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = {
  title: "Page not found — Zitadel preview",
};

/**
 * The host's 404: the cloud sends a browser here for any path no service
 * answers (repo-root vercel.json), while a program gets the API's envelope.
 * It has the anatomy every error page shares (ADR 076), the status, a title,
 * one sentence and the ways on, between the site's own header and footer.
 */
export default function NotFound() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem] bg-[radial-gradient(45%_55%_at_50%_0%,color-mix(in_oklch,var(--color-text-accent)_12%,transparent),transparent)]"
      />
      <SiteHeader />
      <main className="flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center px-6 py-24 text-center">
        <p className="font-mono text-text-muted text-xs uppercase tracking-[0.08em]">Error 404</p>
        <h1 className="mt-4 text-balance font-heading text-4xl text-text-primary tracking-tight md:text-5xl">
          Page not found
        </h1>
        <p className="mt-4 max-w-md text-pretty text-base text-text-secondary leading-7">
          There is nothing at this address. The link may be broken, or the page may have moved.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="/" className={`${BUTTON} bg-text-primary text-background hover:opacity-85`}>
            Go to the start page
          </a>
          <a
            href={links.docs}
            className={`${BUTTON} border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]`}
          >
            Read the docs
          </a>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
