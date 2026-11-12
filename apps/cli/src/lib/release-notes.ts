import semver from "semver";

const RELEASES_API = "https://api.github.com/repos/zitadel/nextgen/releases?per_page=100";
const LOOKUP_TIMEOUT_MS = 3000;
const BREAKING_MARKER = "**Breaking:**";

/** The page a person reads a release's notes on, whatever {@link breakingChanges} could fetch. */
export const RELEASE_NOTES_URL = "https://github.com/zitadel/nextgen/releases";

export type BreakingChange = { version: string; note: string };

/**
 * The `**Breaking:**` notes of every release after `from`, up to and including
 * `to`, oldest first. Until 1.0.0 a minor version can break, and its release
 * note says so with that marker. Never throws: without an answer the list is
 * empty, and the caller still links {@link RELEASE_NOTES_URL}.
 */
export async function breakingChanges(from: string, to: string): Promise<BreakingChange[]> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const releases = (await response.json()) as Array<{ tag_name?: unknown; body?: unknown }>;
    return releases
      .flatMap((release) => {
        const version = semver.valid(String(release.tag_name));
        return version !== null && semver.gt(version, from) && semver.lte(version, to)
          ? breakingNotes(String(release.body ?? "")).map((note) => {
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
 * Each whole paragraph that says what breaks, on one line. The marker may open
 * a paragraph or follow an entry's package names (`release-github.mjs` writes
 * `- \`@zitadel/cli\`: **Breaking:** …`), and a note may wrap onto more lines,
 * so a paragraph ends at a blank line or the next entry, not at its line break.
 */
function breakingNotes(body: string): string[] {
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
