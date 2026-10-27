import type { Metadata } from "next";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import { Markdown } from "./markdown";
import { OpenLinkedRelease } from "./open-linked-release";
import { BreakingChanges, changeCount, DATE, LINK, releasePath } from "./release";
import { FIRST_RELEASE, type Release, readReleases } from "./releases";

// Built from the repository (releases.ts), so a deploy brings a release and
// its post; nothing is read per visit.
export const dynamic = "force-static";

/**
 * How many releases the page shows, newest first; the older ones are links to
 * their own pages. Each carries its post and breaking changes, folded or not.
 */
const SHOWN = 5;

const title = "Changelog — Zitadel preview";
const description =
  "What each release of the Zitadel preview changes in the CLI, the server, the console, the login and the SDKs.";

// The share image is the front page's (layout.tsx): a page's openGraph
// replaces the layout's whole. GitHub's feed of the releases stands in for
// one of the page's own, which would need the posts as HTML (markdown.tsx).
export const metadata: Metadata = {
  title,
  description,
  alternates: {
    types: { "application/atom+xml": [{ url: links.releasesFeed, title: "Zitadel releases" }] },
  },
  openGraph: {
    type: "website",
    siteName: "Zitadel",
    title,
    description,
    images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [og.src] },
};

export default function ChangelogPage() {
  const releases = readReleases();
  const older = releases.slice(SHOWN);
  const github = (
    <a href={links.releases} className={LINK}>
      GitHub
    </a>
  );
  return (
    <>
      <SiteHeader current="changelog" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            Changelog
          </h1>
          <p className="mt-4 text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            What each release of the preview changes.
          </p>
          {releases.length > 0 ? (
            <>
              <ol className="mt-12 border-border-primary border-b">
                {releases.slice(0, SHOWN).map((release, index) => (
                  <ReleaseEntry key={release.tag} release={release} open={index === 0} />
                ))}
              </ol>
              {older.length > 0 && (
                <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary leading-6">
                  Earlier:
                  {older.map(({ tag }) => (
                    <a key={tag} href={releasePath(tag)} className={`font-mono ${LINK}`}>
                      {tag}
                    </a>
                  ))}
                </p>
              )}
              <p className="mt-8 text-sm text-text-muted leading-6">
                Every release from {FIRST_RELEASE} on; {github} also has the alpha previews before
                it. Follow new releases with{" "}
                <a href={links.releasesFeed} className={LINK}>
                  GitHub's feed
                </a>
                .
              </p>
              <OpenLinkedRelease />
            </>
          ) : (
            <p className="mt-12 rounded-xl border border-window-border bg-window px-5 py-4 text-sm text-text-secondary leading-6">
              The first release, {FIRST_RELEASE}, is not out yet; {github} has the alpha previews
              before it.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * One release, the newest open and the others folded to their version, date
 * and count: its post first, then its breaking changes in full, and the way
 * to every change on the release's own page.
 */
function ReleaseEntry({ release, open }: { release: Release; open: boolean }) {
  const { changes } = release;
  return (
    <li id={release.tag} className="scroll-mt-20 border-border-primary border-t">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 rounded-lg py-5 [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="mt-1 size-4 shrink-0 -rotate-90 text-text-muted transition-transform group-open:rotate-0"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-mono text-sm text-text-primary leading-6 md:text-base">
              {release.tag}
            </h2>
            {release.date && (
              <time dateTime={release.date} className="text-sm text-text-muted leading-6">
                {DATE.format(new Date(release.date))}
              </time>
            )}
            <span className="ml-auto font-mono text-text-muted text-xs leading-6">
              {changeCount(changes)}
            </span>
          </div>
        </summary>
        <div className="flex flex-col gap-8 pb-10 sm:pl-7">
          {release.notes && <Markdown under={2}>{release.notes}</Markdown>}
          <BreakingChanges changes={changes} under={2} />
          <p className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            {changes.length > 0 && (
              <a
                href={releasePath(release.tag)}
                className="group/all inline-flex h-9 items-center gap-2 rounded-lg border border-window-border bg-tint/[0.03] px-4 font-semibold text-text-primary transition-colors hover:bg-tint/[0.07]"
              >
                All {changes.length} {changes.length === 1 ? "change" : "changes"}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="size-4 transition-transform group-hover/all:translate-x-0.5"
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
            )}
            <a href={release.url} className={LINK}>
              {release.tag} on GitHub
            </a>
          </p>
        </div>
      </details>
    </li>
  );
}
