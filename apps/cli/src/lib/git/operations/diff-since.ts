import type { Git } from "../git";
import type { Check, Operation } from "../operation";
import type { ColoredDiffOptions } from "../types";
import { DiffFilesSince } from "./diff-files-since";

/** The diff of `paths` since `commit`, untracked files as added, as one text for a terminal. */
export class DiffSince implements Operation<string | null> {
  private readonly files: DiffFilesSince;

  /** Diffs `paths` since `commit`, as `options` say. */
  constructor(commit: string, paths: readonly string[], options: ColoredDiffOptions) {
    this.files = new DiffFilesSince(commit, paths, options);
  }

  /** Those of the split diff. */
  checks(): Check[] {
    return this.files.checks();
  }

  /** No diff: there is nothing to diff against. */
  refused(): string | null {
    return null;
  }

  /** Each changed file's patch, joined. */
  async run(git: Git): Promise<string> {
    const files = await this.files.run(git);
    return files.map((file) => file.patch).join("");
  }
}
