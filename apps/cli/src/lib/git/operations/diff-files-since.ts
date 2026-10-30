import { Change } from "../change";
import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import type { DiffedFile } from "../types";
import { DiffSince } from "./diff-since";

/**
 * The changed files under `paths` since `commit`, untracked files as added, each with its part of the diff.
 *
 * Built from the same single `git diff` as {@link DiffSince}, so joined back
 * together the patches are the diff a terminal shows. `--submodule=short`
 * keeps a submodule's part under a `diff --git` header, which
 * `diff.submodule=log` would replace with a `Submodule …` line that belongs
 * to no file; it is set here only, so the terminal diff stays as the
 * developer configured it.
 */
export class DiffFilesSince implements Operation<DiffedFile[] | null> {
  private readonly diff: DiffSince;

  /** Diffs `paths` since `commit`, uncoloured, with the list of changed files ahead of the patch. */
  constructor(commit: string, paths: readonly string[]) {
    this.diff = new DiffSince(commit, paths, {}, ["--raw", "-z", "--patch", "--submodule=short"]);
  }

  /** Those of the diff. */
  checks(): Check[] {
    return this.diff.checks();
  }

  /** No diff: there is nothing to diff against. */
  refused(): DiffedFile[] | null {
    return null;
  }

  /**
   * Each listed file paired with its section of the patch.
   *
   * `--raw -z` lists every file's status and paths, unquoted, ahead of the
   * patch; one more NUL ends the list. git writes the list and the patch from
   * one list of files, in one order, so they pair one to one. The exception is
   * a file whose type changed (a file replaced by a symlink): git shows it as
   * two sections under one header, which are joined. The patch is split only
   * where `diff --git` follows a newline. A file's content may mention it, and
   * a file with old Mac line endings (a lone `\r`) has no newline before it,
   * so its section stays whole.
   */
  async run(git: Git): Promise<DiffedFile[]> {
    const output = await this.diff.run(git);
    const end = output.indexOf("\0\0");
    if (end === -1) {
      return [];
    }
    const patches: string[] = [];
    for (const section of output.slice(end + 2).split(/(?<=\n)(?=diff --git )/)) {
      const last = patches.at(-1);
      if (
        last !== undefined &&
        last.slice(0, last.indexOf("\n")) === section.slice(0, section.indexOf("\n"))
      ) {
        patches[patches.length - 1] = last + section;
      } else {
        patches.push(section);
      }
    }
    return Change.listedIn(output.slice(0, end).split("\0")).map((change, index) =>
      change.diffedWith(patches[index] ?? ""),
    );
  }
}
