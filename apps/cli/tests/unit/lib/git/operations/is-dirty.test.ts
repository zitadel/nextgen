import { describe, expect, it } from "vitest";

import { IsDirty } from "../../../../../src/lib/git/operations/is-dirty";
import { fakeGit } from "../../../../helpers/git-repo";

describe("IsDirty", () => {
  it.each([
    ["", false],
    [" M a.txt\n", true],
  ])("with status %j is %s", async (stdout, dirty) => {
    expect(await new IsDirty().run(fakeGit(() => ({ stdout })))).toBe(dirty);
  });
});
