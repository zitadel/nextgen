import { describe, expect, it } from "vitest";

import { AuthorIdentity } from "../../../../src/lib/git/author-identity";
import { fakeGit } from "../../../helpers/git-repo";

/** A git that has its own identity when `own`, and can guess one when `guess`. */
function gitWith(own: boolean, guess: boolean) {
  return fakeGit((args) => {
    const configured = args.includes("user.useConfigOnly=true");
    if ((configured && own) || (!configured && guess)) {
      return {};
    }
    return { exitCode: 128 };
  });
}

describe("AuthorIdentity", () => {
  it.each([
    [true, true, "yours"],
    [false, true, "guessed"],
    [false, false, "fallback"],
  ])("with its own %s and a guess %s, comes from %s", async (own, guess, source) => {
    expect((await AuthorIdentity.of(gitWith(own, guess))).source).toBe(source);
  });
});
