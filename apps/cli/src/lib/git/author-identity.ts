import type { Git } from "./git";
import type { Author, AuthorSource } from "./types";

/**
 * Whose name git puts on a commit, and the fallback for when it can name no one.
 *
 * Three cases: the developer has an identity of their own (config or
 * `GIT_AUTHOR_*`), git can only guess one from the username and hostname, or
 * git cannot build one at all, as on a bare CI runner. Only the last uses the
 * fallback, since an invented author is worse than git's own guess; the
 * caller is told which it was, so it can say so. The fallback itself comes
 * from the caller: this module names no one.
 */
export class AuthorIdentity {
  /** Where the author's name comes from. */
  readonly source: AuthorSource;
  private readonly fallback: Author;

  /** The identity from `source`, with `fallback` for when git has none. */
  private constructor(source: AuthorSource, fallback: Author) {
    this.source = source;
    this.fallback = fallback;
  }

  /**
   * The identity git would commit with in `git`'s directory, with `fallback` for when it has none.
   *
   * Without an identity of the developer's own, git guesses one from the
   * username and hostname and commits anyway; `user.useConfigOnly` turns that
   * guess back into an error, which tells a real identity from a guessed one.
   * Only where git cannot even guess, as in a bare CI container, is the
   * fallback used: no commit would leave nothing to diff a deploy against.
   */
  static async of(git: Git, fallback: Author): Promise<AuthorIdentity> {
    const own = await git.run(["-c", "user.useConfigOnly=true", "var", "GIT_AUTHOR_IDENT"], [128]);
    if (own.succeeded()) {
      return new AuthorIdentity("yours", fallback);
    }
    const any = await git.run(["var", "GIT_AUTHOR_IDENT"], [128]);
    if (any.succeeded()) {
      return new AuthorIdentity("guessed", fallback);
    }
    return new AuthorIdentity("fallback", fallback);
  }

  /**
   * The environment that names the fallback as author and committer, or nothing when git has its own.
   *
   * The environment rather than `-c user.*`: an inherited empty
   * `GIT_AUTHOR_NAME=`, as some CI runners leave it, outranks `-c`, and git
   * would refuse the commit with "empty ident name".
   */
  environment(): NodeJS.ProcessEnv {
    if (this.source !== "fallback") {
      return {};
    }
    return {
      GIT_AUTHOR_NAME: this.fallback.name,
      GIT_AUTHOR_EMAIL: this.fallback.email,
      GIT_COMMITTER_NAME: this.fallback.name,
      GIT_COMMITTER_EMAIL: this.fallback.email,
    };
  }
}
