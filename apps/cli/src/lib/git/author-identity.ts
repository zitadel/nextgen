import type { Git } from "./git";
import type { AuthorSource } from "./types";

/**
 * Where the author's name on a commit would come from.
 *
 * Three cases: the developer has an identity of their own (config or
 * `GIT_AUTHOR_*`), git can only guess one from the username and hostname, or
 * git cannot build one at all, as on a bare CI runner. Only the last needs an
 * author supplied, since an invented author is worse than git's own guess;
 * the caller is told which it was, so it can say so. Applying an author to a
 * commit is {@link StagingArea.commit}'s job.
 */
export class AuthorIdentity {
  /** Where the author's name comes from. */
  readonly source: AuthorSource;

  /** The identity from `source`. */
  private constructor(source: AuthorSource) {
    this.source = source;
  }

  /**
   * Where the author git would commit with in `git`'s directory comes from.
   *
   * Without an identity of the developer's own, git guesses one from the
   * username and hostname and commits anyway; `user.useConfigOnly` turns that
   * guess back into an error, which tells a real identity from a guessed one.
   */
  static async of(git: Git): Promise<AuthorIdentity> {
    const own = await git.run(["-c", "user.useConfigOnly=true", "var", "GIT_AUTHOR_IDENT"], [128]);
    if (own.succeeded()) {
      return new AuthorIdentity("yours");
    }
    const any = await git.run(["var", "GIT_AUTHOR_IDENT"], [128]);
    if (any.succeeded()) {
      return new AuthorIdentity("guessed");
    }
    return new AuthorIdentity("fallback");
  }
}
