import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { SIGN_IN_SPEC } from "@/lib/test-kit";
import { test } from "@tests/helpers/fixtures";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

/** What a run answers, as far as these tests read it. */
type Answer = Readonly<{
  status: string;
  code?: string;
  message?: string;
  hint?: string;
  data?: { files_written?: string[] };
}>;

/** A test of the developer's own, where the suite's first test goes. */
const OWN_SPEC = 'import { test } from "@playwright/test";\n';

/** Lays out what setup leaves in `dir` for `framework`, minus what `without` names. */
async function aProject(
  dir: string,
  { framework = "next", without = [] }: { framework?: string; without?: string[] } = {},
): Promise<void> {
  const files: Record<string, string> = {
    "zitadel.json": `${JSON.stringify({ version: "0.0.1" })}\n`,
    ".zitadel/state.json": `${JSON.stringify({ framework })}\n`,
    "package.json": `${JSON.stringify({ name: "app", dependencies: { next: "^16.0.0" } })}\n`,
  };
  await mkdir(join(dir, ".zitadel"), { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    if (!without.includes(path)) {
      await writeFile(join(dir, path), contents);
    }
  }
}

/** Runs `tests add` in `dir`, without installing. */
async function testsAdd(dir: string, ...extra: string[]): Promise<Answer> {
  const result = await runCliForTest([
    "tests",
    "add",
    "--cwd",
    dir,
    "--json",
    "--skip-install",
    ...extra,
  ]);
  return parseJson(result.stdout) as Answer;
}

describe("tests add", () => {
  describe("when it refuses", () => {
    test.for([
      {
        name: "a directory setup has not made a project",
        arrange: (dir: string) => aProject(dir, { without: ["zitadel.json"] }),
        code: "E_VALIDATION",
        message: "This directory is not a Zitadel project",
      },
      {
        name: "a project without its state",
        arrange: (dir: string) => aProject(dir, { without: [".zitadel/state.json"] }),
        code: "E_VALIDATION",
        message: "This directory is not a Zitadel project",
      },
      {
        name: "a framework it has no suite for",
        arrange: (dir: string) => aProject(dir, { framework: "nuxt" }),
        code: "E_VALIDATION",
        message: "tests add does not support nuxt apps yet",
      },
      {
        name: "a project without a package.json",
        arrange: (dir: string) => aProject(dir, { without: ["package.json"] }),
        code: "E_VALIDATION",
        message: "package.json is required to add the test suite",
      },
      {
        name: "an app with a Playwright config of another name",
        arrange: async (dir: string) => {
          await aProject(dir);
          await writeFile(join(dir, "playwright.config.ts"), "export default {};\n");
        },
        code: "E_CONFLICT",
        message: "This app already has a Playwright config, playwright.config.ts",
      },
    ])("refuses $name", async ({ arrange, code, message }, { dir }) => {
      await arrange(dir);

      const answer = await testsAdd(dir);

      expect(answer).toMatchObject({ status: "error", code, message });
    });

    test("names the frameworks it supports", async ({ dir }) => {
      await aProject(dir, { framework: "nuxt" });

      const answer = await testsAdd(dir);

      expect(answer.hint).toContain("It writes a suite for: Next.js.");
    });

    test("refuses to replace a test of the developer's own", async ({ dir }) => {
      await aProject(dir);
      await mkdir(join(dir, "e2e"));
      await writeFile(join(dir, SIGN_IN_SPEC), OWN_SPEC);

      const answer = await testsAdd(dir);

      expect(answer).toMatchObject({ status: "error", code: "E_CONFLICT" });
    });

    test("writes nothing when one file conflicts", async ({ dir }) => {
      await aProject(dir);
      await mkdir(join(dir, "e2e"));
      await writeFile(join(dir, SIGN_IN_SPEC), OWN_SPEC);

      await testsAdd(dir);

      expect(await readFile(join(dir, "package.json"), "utf8")).not.toContain("@zitadel/testing");
    });
  });

  describe("with --force", () => {
    test("replaces a test of the developer's own", async ({ dir }) => {
      await aProject(dir);
      await mkdir(join(dir, "e2e"));
      await writeFile(join(dir, SIGN_IN_SPEC), OWN_SPEC);

      await testsAdd(dir, "--force");

      expect(await readFile(join(dir, SIGN_IN_SPEC), "utf8")).toContain("loginWithPassword");
    });
  });

  describe("with --dry-run", () => {
    test("writes nothing", async ({ dir }) => {
      await aProject(dir);

      await testsAdd(dir, "--dry-run");

      expect(await readFile(join(dir, "package.json"), "utf8")).not.toContain("@zitadel/testing");
    });
  });
});
