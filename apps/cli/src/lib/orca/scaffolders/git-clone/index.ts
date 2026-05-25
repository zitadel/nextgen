import { AbstractGitCloneScaffolder } from "../types";

/**
 * Git-clone-based scaffolder stub.
 * Not yet active — uncomment in scaffolders/index.ts to enable.
 */
export class GitCloneScaffolder extends AbstractGitCloneScaffolder {
  readonly displayName = "Git Clone";
  readonly supportedFrameworks: readonly string[] = [];
  readonly templateUrl = "";
}
