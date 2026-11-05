import type { Entry } from "./entries";

// What the changelog's pages show of an entry beside its story (page.tsx,
// [slug]/page.tsx).

export const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export const LINK =
  "text-text-primary underline decoration-border-secondary underline-offset-4 transition-colors hover:decoration-text-primary";

/**
 * Where an entry has landed: live on the cloud, which runs main, as soon as it
 * merged, and for the CLI, the SDKs and a self-hosted server with the release
 * that carries its pull requests, or not yet.
 */
export function Availability({ entry, className = "" }: { entry: Entry; className?: string }) {
  if (!entry.cloud && entry.pulls.length === 0) return null;
  return (
    <p
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted leading-6 ${className}`}
    >
      {entry.cloud && (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          Live on preview.zitadel.com
        </span>
      )}
      {entry.pulls.length > 0 &&
        (entry.release ? (
          <a href={entry.release.url} className="transition-colors hover:text-text-primary">
            Released in <span className="font-mono">{entry.release.tag}</span>
          </a>
        ) : (
          <span>Not released yet</span>
        ))}
    </p>
  );
}

/** The pull requests that shipped an entry. */
export function PullRequests({ entry }: { entry: Entry }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-muted leading-6">
      {entry.pulls.length === 1 ? "Pull request" : "Pull requests"}
      {entry.pulls.map((pull) => (
        <a
          key={pull}
          href={`https://github.com/zitadel/nextgen/pull/${pull}`}
          className="font-mono transition-colors hover:text-text-primary"
        >
          #{pull}
        </a>
      ))}
    </p>
  );
}
