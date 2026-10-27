import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { links } from "../../links";
import og from "../../og.jpg";
import { SiteFooter } from "../../site-footer";
import { SiteHeader } from "../../site-header";
import { Markdown } from "../markdown";
import { BREAKING, BreakingChanges, ChangeList, changeCount, DATE, LINK } from "../release";
import { readReleases } from "../releases";

// A release's own page, /changelog/v0.2.0: its post, its breaking changes and
// every change. The build makes one for every release from the repository
// (releases.ts); any other tag is not found.
export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ tag: string }> };

export function generateStaticParams(): { tag: string }[] {
  return readReleases().map(({ tag }) => ({ tag }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params;
  const title = `${tag} — Changelog — Zitadel preview`;
  const description = `What ${tag} of the Zitadel preview changes in the CLI, the server, the console, the login and the SDKs.`;
  return {
    title,
    description,
    alternates: {
      types: { "application/atom+xml": [{ url: links.releasesFeed, title: "Zitadel releases" }] },
    },
    openGraph: {
      type: "article",
      siteName: "Zitadel",
      title,
      description,
      images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [og.src] },
  };
}

export default async function ReleasePage({ params }: Props) {
  const { tag } = await params;
  const release = readReleases().find((candidate) => candidate.tag === tag);
  if (!release) notFound();
  return (
    <>
      <SiteHeader current="changelog" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl">
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
          <h1 className="mt-3 font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            {release.tag}
          </h1>
          <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-muted leading-6">
            {release.date && (
              <time dateTime={release.date}>{DATE.format(new Date(release.date))}</time>
            )}
            <span>{changeCount(release.changes)}</span>
            <a href={release.url} className={LINK}>
              On GitHub
            </a>
          </p>
          <div className="mt-10 flex flex-col gap-10">
            {release.notes && <Markdown under={1}>{release.notes}</Markdown>}
            <BreakingChanges changes={release.changes} under={1} id={BREAKING} />
            {release.changes.length > 0 && <ChangeList release={release} />}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
