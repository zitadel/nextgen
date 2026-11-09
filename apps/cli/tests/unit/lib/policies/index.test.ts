import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Git } from "@/lib/git/git";
import {
  isPolicyTestFile,
  PASSWORD_POLICY_PATH,
  POLICY_FILES_GLOB,
  POLICY_TEST_FILES_GLOB,
  parsePasswordMinLength,
  passwordPolicyFile,
  policyFileName,
  toPolicyWireBody,
} from "@/lib/policies";
import { CONFIG_DIRECTORIES, DiskStore, ZitadelConfig } from "@/lib/zitadel";
import { GitScratch, isolateGit } from "@tests/helpers/git-repo";

describe("parsePasswordMinLength", () => {
  it.each([
    // "None" is an answer of its own, apart from not being asked at all.
    ["", null],
    ["  ", null],
    // A minimum of 0 enforces nothing: it means none, never a stored 0.
    ["0", null],
    ["00", null],
    ["1", 1],
    ["15", 15],
    ["64", 64],
  ])("reads %j as %j", (text, value) => {
    expect(parsePasswordMinLength(text)).toEqual({ ok: true, value });
  });

  it.each(["65", "12.5", "-3", "twelve", "1e1"])("refuses %j", (text) => {
    expect(parsePasswordMinLength(text)).toMatchObject({
      ok: false,
      problem: "Must be a whole number from 1 to 64, or 0 for none",
    });
  });
});

describe("passwordPolicyFile", () => {
  it("sets the recommended minimum when none was given", () => {
    expect(passwordPolicyFile()).toEqual({
      $schema: "../meta/policy.json",
      operation: "auth.factor.password.set",
      config: { min_length: 15 },
    });
  });

  it("enforces nothing for an explicit none", () => {
    expect(passwordPolicyFile(null).config).toEqual({});
  });

  it("sets the minimum it is given", () => {
    expect(passwordPolicyFile(12).config).toEqual({ min_length: 12 });
  });

  it("is written where the policy syncer expects it", () => {
    expect(PASSWORD_POLICY_PATH).toBe(".zitadel/policies/auth.factor.password.set.json");
  });
});

describe("toPolicyWireBody", () => {
  it("drops the editor's $schema pointer", () => {
    expect(toPolicyWireBody(passwordPolicyFile(12))).toEqual({
      operation: "auth.factor.password.set",
      config: { min_length: 12 },
    });
  });
});

describe("policyFileName", () => {
  it("names the file after its operation", () => {
    expect(policyFileName("auth.factor.password.set")).toBe("auth.factor.password.set.json");
  });
});

describe("isPolicyTestFile", () => {
  it.each([
    ["auth.factor.password.set.test.json", true],
    ["auth.factor.password.set.json", false],
    ["auth.factor.password.set.TEST.json", false],
  ])("takes %j as a test file: %j", (name, expected) => {
    expect(isPolicyTestFile(name)).toBe(expected);
  });
});

const POLICIES_DIR = CONFIG_DIRECTORIES.policies;

const scratch = new GitScratch();

beforeEach(isolateGit);

afterEach(async () => {
  await scratch.cleanup();
});

describe("POLICY_FILES_GLOB and POLICY_TEST_FILES_GLOB", () => {
  it("take in for git exactly the policy files the bundle reads", async () => {
    const names = [
      "a.json",
      "a.test.json",
      ".test.json",
      "b.TEST.json",
      "c.json.bak",
      "README.md",
      "sub/d.json",
      "sub/d.test.json",
    ];
    const cwd = await scratch.committed(
      Object.fromEntries(
        names.map((name) => {
          return [`${POLICIES_DIR}/${name}`, "{}\n"];
        }),
      ),
    );

    const diffed = await new Git(cwd).run([
      "ls-files",
      "-z",
      "--",
      Git.glob(POLICY_FILES_GLOB),
      Git.excluded(POLICY_TEST_FILES_GLOB),
    ]);
    const config = await ZitadelConfig.loadUnchecked(new DiskStore(cwd));

    expect(diffed.paths()).toEqual(
      config.policies.all.map((policy) => {
        return policy.path;
      }),
    );
    expect(diffed.paths()).toEqual([`${POLICIES_DIR}/a.json`, `${POLICIES_DIR}/b.TEST.json`]);
  });
});
