import type { Git } from "../git";
import type { Check, Operation } from "../operation";

/**
 * The subject line of the commit the repository is at, or null before its first commit.
 *
 * `--no-show-signature` overrides a developer's `log.showSignature`, which
 * would otherwise put gpg's lines ahead of the subject on a signed commit. A
 * repository with no commit yet makes `git log` exit 128, which is an answer,
 * null, not a failure.
 */
export class CurrentSubject implements Operation<string | null> {
  /** Nothing to check. */
  checks(): Check[] {
    return [];
  }

  /** Never refused. */
  refused(): string | null {
    return null;
  }

  /** Asks git for HEAD's subject. */
  async run(git: Git): Promise<string | null> {
    const result = await git.run(["log", "-1", "--no-show-signature", "--format=%s"], [128]);
    if (!result.succeeded()) {
      return null;
    }
    return result.text() || null;
  }
}
