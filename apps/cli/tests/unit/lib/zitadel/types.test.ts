import { beforeEach, describe, expect } from "vitest";

import { Git } from "@/lib/git/git";
import { CONFIG_DIRECTORIES, DiskStore, RELEASE_POLICY_GLOBS, ZitadelConfig } from "@/lib/zitadel";
import { aPasswordPolicy } from "@tests/helpers/config";
import { it } from "@tests/helpers/fixtures";
import { commitAll, git, isolateGit, write } from "@tests/helpers/git-repo";

/**
 * Every kind of name a file under `.zitadel/policies/` might have.
 */
const POLICY_NAMES = [
  "a.json",
  "a.test.json",
  ".test.json",
  "b.TEST.json",
  "c.json.bak",
  "README.md",
  "sub/d.json",
  "sub/d.test.json",
];

/**
 * Makes `dir` a repository whose one commit holds a sound password policy
 * under each of `names` in `.zitadel/policies/`.
 *
 * @param dir - The directory to commit in.
 * @param names - The files' names under `.zitadel/policies/`.
 */
async function commitPolicies(dir: string, names: readonly string[]): Promise<void> {
  await git(dir, "init", "--quiet");
  await write(
    dir,
    Object.fromEntries(
      names.map((name) => {
        return [`${CONFIG_DIRECTORIES.policies}/${name}`, `${JSON.stringify(aPasswordPolicy())}\n`];
      }),
    ),
  );
  await commitAll(dir, "initial");
}

beforeEach(isolateGit);

describe("RELEASE_POLICY_GLOBS", () => {
  it("takes in for git exactly the policy files the bundle reads", async ({ dir }) => {
    await commitPolicies(dir, POLICY_NAMES);
    const config = await ZitadelConfig.loadUnchecked(new DiskStore(dir));

    const listed = await new Git(dir).run([
      "ls-files",
      "-z",
      "--",
      Git.glob(RELEASE_POLICY_GLOBS.included),
      Git.excluded(RELEASE_POLICY_GLOBS.excluded),
    ]);

    expect(listed.paths()).toEqual(
      config.policies.all.map((policy) => {
        return policy.path;
      }),
    );
  });

  it("leaves out the test files, the README and the subdirectories", async ({ dir }) => {
    await commitPolicies(dir, ["a.json", "a.test.json", "README.md", "sub/d.json"]);

    const listed = await new Git(dir).run([
      "ls-files",
      "-z",
      "--",
      Git.glob(RELEASE_POLICY_GLOBS.included),
      Git.excluded(RELEASE_POLICY_GLOBS.excluded),
    ]);

    expect(listed.paths()).toEqual([`${CONFIG_DIRECTORIES.policies}/a.json`]);
  });
});
