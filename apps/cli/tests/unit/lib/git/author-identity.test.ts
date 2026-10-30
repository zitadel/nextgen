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
    ["the developer's own when they have an identity", true, true, "yours"],
    ["a guess when git can only guess one", false, true, "guessed"],
    ["the fallback when git cannot build one at all", false, false, "fallback"],
  ])("names %s", async (_, own, guess, source) => {
    expect((await AuthorIdentity.of(gitWith(own, guess))).source).toBe(source);
  });
});
