import { links } from "../links";
import { firstParagraph, groupByComponent, isBreaking } from "./changes";
import { Markdown } from "./markdown";
import { type Change, fromFirstRelease, type Release } from "./releases";

// What both changelog pages show of a release (page.tsx, [tag]/page.tsx): its
// breaking changes in full, and on its own page every change by component.

export const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export const LINK =
  "text-text-primary underline decoration-border-secondary underline-offset-4 transition-colors hover:decoration-text-primary";

/** A release's own page, or GitHub's when its tag has none. */
export function releaseHref(release: Pick<Release, "tag" | "url">): string {
  return fromFirstRelease(release.tag)
    ? `${links.changelog}/${encodeURIComponent(release.tag)}`
    : release.url;
}

/** How many changes a release has, and how many of them break. */
export function changeCount(changes: Change[]): string {
  const breaking = changes.filter(isBreaking).length;
  const all = `${changes.length} ${changes.length === 1 ? "change" : "changes"}`;
  return breaking > 0 ? `${all}, ${breaking} breaking` : all;
}

/** The id of a release page's breaking changes, which its list links to. */
export const BREAKING = "breaking";

function changeKey(change: Change): string {
  return `${change.source?.href} ${change.summary}`;
}

/**
 * A release's breaking changes, each in full, as its release notes say what
 * breaks and what to do, under a heading one below `under`.
 */
export function BreakingChanges({
  changes,
  under,
  id,
}: {
  changes: Change[];
  under: 1 | 2;
  /** The heading's id: BREAKING on the release's own page. */
  id?: string;
}) {
  const breaking = changes.filter(isBreaking);
  if (breaking.length === 0) return null;
  const Heading = under === 1 ? "h2" : "h3";
  return (
    <section className="rounded-xl border border-window-border bg-window px-5 pt-4">
      <Heading
        id={id}
        className="flex scroll-mt-20 items-center gap-2 font-semibold text-sm text-text-primary leading-6"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-4 text-step-start">
          <path
            d="M8 2.5 14 13H2L8 2.5Z M8 6.5v3 M8 11.25v.01"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {breaking.length === 1 ? "Breaking change" : `${breaking.length} breaking changes`}
      </Heading>
      <ul>
        {breaking.map((change) => (
          <li
            key={changeKey(change)}
            className="border-border-primary border-t py-4 first:border-t-0"
          >
            <Markdown>{change.summary}</Markdown>
            <p className="mt-2">
              <ChangeMeta change={change} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Every change of a release by component, a line each where its summary is
 * one sentence: the summary runs on into its packages, pull request and
 * authors (`.change-line` in globals.css). A breaking change shows its first
 * paragraph and links to the whole of it under the breaking changes.
 */
export function ChangeList({ release }: { release: Release }) {
  const groups = groupByComponent(release);
  const releaseNotices = release.notices.filter((notice) => !notice.package);
  return (
    <section aria-labelledby="changes">
      <h2 id="changes" className="font-heading text-2xl text-text-primary leading-tight">
        All {release.changes.length} {release.changes.length === 1 ? "change" : "changes"}
      </h2>
      {groups.length > 1 && (
        <nav aria-label="Components" className="mt-5 flex flex-wrap gap-2">
          {groups.map(({ component, changes }) => (
            <a
              key={component.id}
              href={`#${component.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-window-border px-3 font-semibold text-text-secondary text-xs transition-colors hover:bg-tint/[0.06] hover:text-text-primary"
            >
              {component.label}
              <span className="font-mono opacity-60">{changes.length}</span>
            </a>
          ))}
        </nav>
      )}
      {groups.map(({ component, changes, notices }) => (
        <section key={component.id} aria-labelledby={component.id} className="mt-10">
          <h3
            id={component.id}
            className="flex scroll-mt-20 items-baseline gap-2 font-semibold text-[0.9375rem] text-text-primary leading-6"
          >
            {component.label}
            <span className="font-mono font-normal text-text-muted text-xs">{changes.length}</span>
          </h3>
          <ul className="mt-2">
            {changes.map((change) => (
              <ChangeLine key={changeKey(change)} change={change} component={component.id} />
            ))}
          </ul>
          {notices.map((notice) => (
            <Markdown key={notice.text} className="mt-2 text-sm text-text-muted">
              {notice.text}
            </Markdown>
          ))}
        </section>
      ))}
      {releaseNotices.map((notice) => (
        <Markdown key={notice.text} className="mt-8 text-sm text-text-muted">
          {notice.text}
        </Markdown>
      ))}
    </section>
  );
}

function ChangeLine({ change, component }: { change: Change; component: string }) {
  const breaks = isBreaking(change);
  return (
    <li className="change-line border-border-primary border-t py-3 first:border-t-0">
      {breaks && (
        <a
          href={`#${BREAKING}`}
          className="mr-2 rounded-full bg-step-start/15 px-2 py-0.5 font-semibold text-[0.6875rem] text-text-primary leading-4 transition-colors hover:bg-step-start/25"
        >
          Breaking
        </a>
      )}
      <Markdown>{breaks ? firstParagraph(change.summary) : change.summary}</Markdown>{" "}
      <ChangeMeta change={change} except={component} />
    </li>
  );
}

/**
 * A change's packages, but the one its component is named for, then its pull
 * request and its authors.
 */
function ChangeMeta({ change, except }: { change: Change; except?: string }) {
  const packages = change.packages
    .map((name) => name.replace(/^@zitadel\//, ""))
    .filter((name) => name !== except);
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1 align-baseline font-mono text-text-muted text-xs leading-5">
      {packages.map((name) => (
        <span key={name}>{name}</span>
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
    </span>
  );
}
