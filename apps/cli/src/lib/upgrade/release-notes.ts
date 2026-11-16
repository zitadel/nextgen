import semver from "semver";

import { RELEASE_NOTES_URL, RELEASES_API } from "./defaults";

/** The default time a lookup of the releases may take. */
const LOOKUP_TIMEOUT_MS = 3000;

/** What a release note opens a breaking change with. */
const BREAKING_MARKER = "**Breaking:**";

/** One breaking change a release's notes announce. */
export type BreakingChange = { version: string; note: string };

/**
 * The notes of the releases a CLI is upgraded across. It takes where they are
 * published as options, so a test or another product can point it elsewhere.
 */
export class ReleaseNotes {
  /** The page a person reads a release's notes on, whatever {@link breakingBetween} could fetch. */
  readonly url: string;

  /** The API the releases are listed from. */
  private readonly api: string;

  /** How long the lookup may take, in milliseconds. */
  private readonly timeoutMs: number;

  /**
   * @param options - Where the notes are published; GitHub's releases of this
   *   repository when left out.
   * @param options.url - The page a person reads them on.
   * @param options.api - The API that lists them.
   * @param options.timeoutMs - How long the lookup may take.
   */
  constructor(options: { url?: string; api?: string; timeoutMs?: number } = {}) {
    this.url = options.url ?? RELEASE_NOTES_URL;
    this.api = options.api ?? RELEASES_API;
    this.timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  }

  /**
   * The `**Breaking:**` notes of every release after `from`, up to and
   * including `to`, oldest first. Until 1.0.0 a minor version can break, and
   * its release note says so with that marker. Never throws: without an answer
   * the list is empty, and the caller still links {@link ReleaseNotes.url}.
   *
   * @param from - The version being upgraded from, not included.
   * @param to - The version being upgraded to, included.
   * @returns The notes, oldest release first.
   */
  async breakingBetween(from: string, to: string): Promise<BreakingChange[]> {
    try {
      const response = await fetch(this.api, {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return [];
      }
      const releases = (await response.json()) as Array<{ tag_name?: unknown; body?: unknown }>;
      return releases
        .flatMap((release) => {
          const version = semver.valid(String(release.tag_name));
          return version !== null && semver.gt(version, from) && semver.lte(version, to)
            ? ReleaseNotes.breakingNotes(String(release.body ?? "")).map((note) => {
                return { version, note };
              })
            : [];
        })
        .sort((a, b) => {
          return semver.compare(a.version, b.version);
        });
    } catch {
      return [];
    }
  }

  /**
   * Each whole paragraph that says what breaks, on one line. The marker may
   * open a paragraph or follow an entry's package names (`release-github.mjs`
   * writes `- \`@zitadel/cli\`: **Breaking:** …`), and a note may wrap onto
   * more lines, so a paragraph ends at a blank line or the next entry, not at
   * its line break.
   *
   * @param body - A release's notes.
   * @returns The notes, each on one line.
   */
  private static breakingNotes(body: string): string[] {
    return body.split(/\r?\n[ \t]*\r?\n|\r?\n(?=[-*#] )/).flatMap((paragraph) => {
      const at = paragraph.indexOf(BREAKING_MARKER);
      const note =
        at === -1
          ? ""
          : paragraph
              .slice(at + BREAKING_MARKER.length)
              .replace(/\s+/g, " ")
              .trim();
      return note === "" ? [] : [note];
    });
  }
}
