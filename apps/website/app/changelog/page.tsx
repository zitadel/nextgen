import type { Metadata } from "next";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import { type Entry, entryPath, readChangelog } from "./entries";
import { Availability, DATE, LINK } from "./entry";

// Built from the repository (entries.ts), so a deploy brings an entry and the
// release that ships it; nothing is read per visit.
export const dynamic = "force-static";

const title = "Changelog — Zitadel preview";
const description =
  "What's new in the Zitadel preview: the CLI, the server, the console, the login and the SDKs.";

// The share image is the front page's (layout.tsx): a page's openGraph
// replaces the layout's whole.
export const metadata: Metadata = {
  title,
  description,
  alternates: {
    types: { "application/atom+xml": [{ url: links.changelogFeed, title: "Zitadel changelog" }] },
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
  const { entries, releases } = readChangelog();
  return (
    <>
      <SiteHeader current="changelog" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <h1 className="font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
              Changelog
            </h1>
            <a
              href={links.changelogFeed}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-window-border bg-tint/[0.03] px-3 text-sm text-text-secondary transition-colors hover:bg-tint/[0.07] hover:text-text-primary"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4">
                <path
                  d="M3 3a10 10 0 0 1 10 10M3 7a6 6 0 0 1 6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="3.75" cy="12.25" r="1.25" fill="currentColor" />
              </svg>
              Feed
            </a>
          </div>
          <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            What's new in the preview. A change to the server is live on preview.zitadel.com as soon
            as it lands; the CLI, the SDKs and a self-hosted server get it with the release that
            ships it.
          </p>
          <ol className="mt-12 md:mt-16">
            {byDay(entries).map(([day, ofDay]) => (
              <li
                key={day}
                className="grid gap-x-12 gap-y-6 border-border-primary border-t py-10 md:grid-cols-[9rem_1fr] md:py-14"
              >
                <time
                  dateTime={day}
                  className="self-start text-sm text-text-muted leading-6 md:sticky md:top-24"
                >
                  {DATE.format(new Date(day))}
                </time>
                <ul className="flex flex-col gap-12">
                  {ofDay.map((entry) => (
                    <EntrySummary key={entry.slug} entry={entry} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {releases.length > 0 && (
            <p className="mt-4 border-border-primary border-t pt-8 text-sm text-text-muted leading-6">
              Every change of each release is in its release notes on GitHub:{" "}
              {releases.map((release, index) => (
                <span key={release.tag}>
                  {index > 0 && ", "}
                  <a href={release.url} className={`font-mono ${LINK}`}>
                    {release.tag}
                  </a>
                </span>
              ))}
              .
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/** An entry on the index: its title, which links to its page, its summary, and where it landed. */
function EntrySummary({ entry }: { entry: Entry }) {
  return (
    <li>
      <h2 className="font-heading text-2xl text-text-primary leading-tight tracking-[-0.015em] md:text-3xl">
        <a
          href={entryPath(entry.slug)}
          className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-border-secondary"
        >
          {entry.title}
        </a>
      </h2>
      <p className="mt-3 text-base text-text-secondary leading-7">{entry.summary}</p>
      <Availability entry={entry} className="mt-3" />
    </li>
  );
}

/** The entries by the day they landed, the newest first, as entries.ts sorts them. */
function byDay(entries: Entry[]): [day: string, entries: Entry[]][] {
  const days = new Map<string, Entry[]>();
  for (const entry of entries) {
    const day = entry.date.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), entry]);
  }
  return [...days];
}
