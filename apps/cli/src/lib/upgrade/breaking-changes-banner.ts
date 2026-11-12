import { RELEASE_NOTES_URL, type BreakingChange } from "@/lib/release-notes";
import { mark, strong, url } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";

/** The breaking changes an upgrade crosses, shown before anything changes so the person can still stop. */
export class BreakingChangesBanner {
  /** The changes, oldest first. */
  private readonly changes: readonly BreakingChange[];

  /**
   * @param changes - The changes, oldest first.
   */
  constructor(changes: readonly BreakingChange[]) {
    this.changes = changes;
  }

  /** The banner: each change, then where to read the release notes. */
  render(): string {
    const notes = this.changes.flatMap(({ version, note }) => {
      return [
        `  ${mark.warn} ${strong(escapeControlCharacters(version))}  ${escapeControlCharacters(note)}`,
      ];
    });
    return [
      ...(notes.length > 0 ? [strong("Breaking changes on the way:"), ...notes] : []),
      `Release notes: ${url(RELEASE_NOTES_URL)}`,
      "",
    ].join("\n");
  }
}
