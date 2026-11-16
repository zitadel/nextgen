/**
 * A file the CLI generated and owns, as the sentinel comment stamped at its top says so.
 *
 * Commands like `doctor` and `eject` look for the marker to decide whether a file is safe to
 * touch, and every scaffolded file template writes it. The trailing `v1` lets the format evolve
 * without mistaking newer managed files for hand-edited ones.
 */
export class ManagedFile {
  /** The sentinel comment stamped at the top of every managed file. */
  static readonly MARKER = "// zitadel-cli: managed-file v1";

  /** The file's text. */
  private readonly contents: string;

  /**
   * @param contents - A file's text.
   */
  constructor(contents: string) {
    this.contents = contents;
  }

  /**
   * Whether the file's text carries the managed-file marker.
   *
   * @returns `true` when the CLI generated the file and still owns it.
   */
  isManaged(): boolean {
    return this.contents.includes(ManagedFile.MARKER);
  }
}
