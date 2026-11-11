import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { links } from "../../links";
import og from "../../og.jpg";
import { SiteFooter } from "../../site-footer";
import { SiteHeader } from "../../site-header";
import { readChangelog } from "../entries";
import { Availability, DATE, PullRequests } from "../entry";
import { Markdown } from "../markdown";

// An entry's own page, /changelog/zitadel-api: its title, where it landed and
// its story. The build makes one for every entry (entries.ts); any other path
// is not found (app/not-found.tsx).
export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

function entryOf(slug: string) {
  return readChangelog().entries.find((entry) => entry.slug === slug);
}

export function generateStaticParams(): { slug: string }[] {
  return readChangelog().entries.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = entryOf((await params).slug);
  if (!entry) return {};
  const title = `${entry.title} — Changelog — Zitadel preview`;
  return {
    title,
    description: entry.summary,
    alternates: {
      types: { "application/atom+xml": [{ url: links.changelogFeed, title: "Zitadel changelog" }] },
    },
    openGraph: {
      type: "article",
      siteName: "Zitadel",
      title,
      description: entry.summary,
      publishedTime: new Date(entry.date).toISOString(),
      images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: entry.summary,
      images: [og.src],
    },
  };
}

export default async function EntryPage({ params }: Props) {
  const entry = entryOf((await params).slug);
  if (!entry) notFound();
  return (
    <>
      <SiteHeader current="changelog" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <article className="mx-auto max-w-3xl">
          <a
            href={links.changelog}
            className="group inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="size-4 transition-transform group-hover:-translate-x-0.5"
            >
              <path
                d="M13 8H3M7 4 3 8l4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Changelog
          </a>
          <time
            dateTime={entry.date.slice(0, 10)}
            className="mt-8 block text-sm text-text-muted leading-6"
          >
            {DATE.format(new Date(entry.date))}
          </time>
          <h1 className="mt-2 font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            {entry.title}
          </h1>
          <Availability entry={entry} className="mt-4" />
          {entry.body && (
            <Markdown under={1} className="mt-10">
              {entry.body}
            </Markdown>
          )}
          {entry.pulls.length > 0 && (
            <div className="mt-10 border-border-primary border-t pt-6">
              <PullRequests entry={entry} />
            </div>
          )}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
