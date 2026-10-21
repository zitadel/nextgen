import type { Metadata } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import {
  ChangeCount,
  ChangelogFilter,
  FilterButtons,
  Filtered,
  NoneFiltered,
} from "./changelog-filter";
import {
  componentOf,
  componentsIn,
  facetOf,
  KIND_LABELS,
  KINDS,
  type Kind,
  kindOf,
  kindsIn,
} from "./filter";
import { Markdown } from "./markdown";
import { OpenLinkedRelease } from "./open-linked-release";
import { type Change, FIRST_RELEASE, fetchReleases, RELEASE_COUNT, type Release } from "./releases";

// The page is built with the releases GitHub has then, and built again in the
// background at most every 15 minutes, when a visit finds it older
// (Incremental Static Regeneration): GitHub is asked once per regeneration,
// never per visit. force-static keeps it static although its fetch is
// uncached (releases.ts).
export const dynamic = "force-static";
export const revalidate = 900;

const title = "Changelog — Zitadel preview";
const description =
  "What each release of the Zitadel preview changes in the CLI, the server, the console, the login and the SDKs.";

// The share image is the front page's (layout.tsx): a page's openGraph
// replaces the layout's whole.
export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Zitadel",
    title,
    description,
    images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [og.src] },
};

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

const LINK =
  "text-text-primary underline decoration-border-secondary underline-offset-4 transition-colors hover:decoration-text-primary";

/**
 * The releases, or none when GitHub does not answer. A regeneration rethrows,
 * so the page served last stays up until one succeeds; the build carries on
 * without them, so GitHub never fails a deploy, and the page links to GitHub
 * until the first regeneration.
 */
async function loadReleases(): Promise<Release[] | undefined> {
  try {
    return await fetchReleases();
  } catch (error) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD
    ) {
      throw error;
    }
    console.warn(`The changelog shows no releases: ${error}`);
    return undefined;
  }
}

export default async function ChangelogPage() {
  const releases = await loadReleases();
  const components = releases ? componentsIn(releases) : [];
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
            What each release of the preview changes, from its release notes on {github}.
          </p>
          {releases ? (
            <ChangelogFilter
              components={components}
              kinds={kindsIn(releases)}
              facets={releases.flatMap((release) => release.changes.map(facetOf))}
            >
              <div className="mt-10">
                <FilterButtons
                  note={
                    components.some(({ id }) => id === "server") &&
                    "The console and the login ship in the server: their changes are under Server."
                  }
                />
              </div>
              <ol className="mt-10 border-border-primary border-b">
                {releases.map((release, index) => (
                  <ReleaseEntry key={release.tag} release={release} open={index === 0} />
                ))}
              </ol>
              <p className="mt-8 text-sm text-text-muted leading-6">
                {releases.length < RELEASE_COUNT ? (
                  <>
                    Every release from {FIRST_RELEASE} on; {github} also has the alpha previews
                    before it.
                  </>
                ) : (
                  <>
                    The last {RELEASE_COUNT} releases; {github} has every one.
                  </>
                )}
              </p>
              <OpenLinkedRelease />
            </ChangelogFilter>
          ) : (
            <p className="mt-12 rounded-xl border border-window-border bg-window px-5 py-4 text-sm text-text-secondary leading-6">
              The release notes did not load. Read them on {github}.
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
 * and count: the maintainers' notes, the changes by kind, then what the
 * release body says of changes it left out. The filters show the changes,
 * and the pointers to left-out ones, that match the visitor's choice.
 */
function ReleaseEntry({ release, open }: { release: Release; open: boolean }) {
  const facets = release.changes.map(facetOf);
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
            {release.publishedAt && (
              <time dateTime={release.publishedAt} className="text-sm text-text-muted leading-6">
                {DATE.format(new Date(release.publishedAt))}
              </time>
            )}
            {facets.length > 0 && (
              <span className="ml-auto font-mono text-text-muted text-xs leading-6">
                <ChangeCount facets={facets} />
              </span>
            )}
          </div>
        </summary>
        <div className="flex flex-col gap-8 pb-10 sm:pl-7">
          {release.notes && <Markdown>{release.notes}</Markdown>}
          <NoneFiltered facets={facets} />
          {KINDS.map((kind) => (
            <ChangeGroup
              key={kind}
              kind={kind}
              changes={release.changes.filter((change) => kindOf(change) === kind)}
            />
          ))}
          {release.notices.map((notice) =>
            notice.package ? (
              <Filtered
                key={`${notice.package} ${notice.text}`}
                facets={[{ components: [componentOf(notice.package).id] }]}
              >
                <Markdown className="text-sm text-text-muted">{`\`${notice.package}\`: ${notice.text}`}</Markdown>
              </Filtered>
            ) : (
              <Markdown key={notice.text} className="text-sm text-text-muted">
                {notice.text}
              </Markdown>
            ),
          )}
          <a href={release.url} className={`self-start text-sm ${LINK}`}>
            {release.tag} on GitHub
          </a>
        </div>
      </details>
    </li>
  );
}

function ChangeGroup({ kind, changes }: { kind: Kind; changes: Change[] }) {
  if (changes.length === 0) return null;
  return (
    <Filtered facets={changes.map(facetOf)}>
      <div>
        <h3 className="font-mono text-text-muted text-xs leading-4">{KIND_LABELS[kind]} changes</h3>
        <ul className="mt-2">
          {changes.map((change) => (
            <Filtered key={`${change.source?.href} ${change.summary}`} facets={[facetOf(change)]}>
              <ChangeEntry change={change} />
            </Filtered>
          ))}
        </ul>
      </div>
    </Filtered>
  );
}

/** A change, under it the packages it changes, its pull request and its authors. */
function ChangeEntry({ change }: { change: Change }) {
  return (
    <li className="border-border-primary border-t py-4 first:border-t-0">
      <Markdown>{change.summary}</Markdown>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-text-muted text-xs leading-5">
        {change.packages.map((name) => (
          <span key={name}>{name.replace(/^@zitadel\//, "")}</span>
        ))}
        {change.source && (
          <a href={change.source.href} className="transition-colors hover:text-text-primary">
            {change.source.label}
          </a>
        )}
        {change.authors.map((author) => (
          <a
            key={author.href}
            href={author.href}
            className="transition-colors hover:text-text-primary"
          >
            {author.label}
          </a>
        ))}
      </p>
    </li>
  );
}
