import type { Git } from "./git";
import type { Author, AuthorSource } from "./types";

/** Whose name git puts on a commit, and the fallback for when it can name no one. */
export class AuthorIdentity {
  /** Where the author's name comes from. */
  readonly source: AuthorSource;
  private readonly fallback: Author;

  /** The identity from `source`, with `fallback` for when git has none. */
  private constructor(source: AuthorSource, fallback: Author) {
    this.source = source;
    this.fallback = fallback;
  }

  /** The identity git would commit with in `git`'s directory, with `fallback` for when it has none. */
  static async of(git: Git, fallback: Author): Promise<AuthorIdentity> {
    // `user.useConfigOnly` turns git's guess from the username and hostname
    // back into an error, which tells a real identity from a guessed one.
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

  /** The environment that names the fallback as author and committer, or nothing when git has its own. */
  environment(): NodeJS.ProcessEnv {
    // The environment rather than `-c user.*`: an inherited empty
    // `GIT_AUTHOR_NAME=` outranks `-c`, and git would refuse the commit.
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
