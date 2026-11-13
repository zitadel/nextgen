import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { pathExists } from "@/lib/fs";
import { PLAYWRIGHT_CONFIG, SIGN_IN_SPEC, SIGNED_IN_SPEC } from "@/lib/test-kit";
import { test } from "@tests/helpers/fixtures";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

/** What a run answers, as far as these tests read it. */
type Answer = Readonly<{
  status: string;
  code?: string;
  message?: string;
  hint?: string;
  data?: { next_actions?: string[]; next_commands?: string[] };
}>;

/** A test of the developer's own, where the suite's test goes. */
const OWN_SPEC = 'import { test } from "@playwright/test";\n';

/** A test:e2e script of the developer's own. */
const OWN_SCRIPT = "vitest run --project e2e";

/** Lays out what setup leaves in `dir` for `framework`, minus what `without` names. */
async function aProject(
  dir: string,
  {
    framework = "next",
    without = [],
    scripts = {},
  }: { framework?: string | null; without?: string[]; scripts?: Record<string, string> } = {},
): Promise<void> {
  const config = {
    version: "0.0.1",
    ...(framework === null ? {} : { framework: { id: framework } }),
  };
  const manifest = { name: "app", scripts, dependencies: { next: "^16.0.0" } };
  const files: Record<string, string> = {
    "zitadel.json": `${JSON.stringify(config)}\n`,
    "package.json": `${JSON.stringify(manifest)}\n`,
  };
  for (const [path, contents] of Object.entries(files)) {
    if (!without.includes(path)) {
      await writeFile(join(dir, path), contents);
    }
  }
}

/** Puts a test of the developer's own at `path` in `dir`. */
async function anOwnTestAt(dir: string, path: string): Promise<void> {
  await mkdir(join(dir, "e2e"), { recursive: true });
  await writeFile(join(dir, path), OWN_SPEC);
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
        name: "a project that records no framework",
        arrange: (dir: string) => aProject(dir, { framework: null }),
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
          await writeFile(join(dir, "playwright.config.mjs"), "export default {};\n");
        },
        code: "E_CONFLICT",
        message: "This app already has a Playwright config, playwright.config.mjs",
      },
      {
        name: "a test of the developer's own where the suite's goes",
        arrange: async (dir: string) => {
          await aProject(dir);
          await anOwnTestAt(dir, SIGNED_IN_SPEC);
        },
        code: "E_CONFLICT",
        message: expect.stringMatching(new RegExp(`^Refusing to overwrite .*/${SIGNED_IN_SPEC}$`)),
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

    test("writes nothing before a file that conflicts", async ({ dir }) => {
      await aProject(dir);
      await anOwnTestAt(dir, SIGNED_IN_SPEC);

      await testsAdd(dir);

      expect(await pathExists(join(dir, PLAYWRIGHT_CONFIG))).toBe(false);
    });
  });

  describe("with a test:e2e script of the app's own", () => {
    test("leaves it as it is", async ({ dir }) => {
      await aProject(dir, { scripts: { "test:e2e": OWN_SCRIPT } });

      await testsAdd(dir);

      expect(await readFile(join(dir, "package.json"), "utf8")).toContain(OWN_SCRIPT);
    });

    test("says to run the suite with Playwright in the app", async ({ dir }) => {
      await aProject(dir, { scripts: { "test:e2e": OWN_SCRIPT } });

      const answer = await testsAdd(dir);

      expect(answer.data?.next_actions).toContain(
        `The app's own test:e2e script runs ${OWN_SCRIPT}, so run the suite with Playwright in ${dir}: npx playwright test`,
      );
    });

    test("suggests no script that would not run the suite", async ({ dir }) => {
      await aProject(dir, { scripts: { "test:e2e": OWN_SCRIPT } });

      const answer = await testsAdd(dir);

      expect(answer.data?.next_commands).toEqual([`npm --prefix ${dir} install`]);
    });
  });

  describe("with no test:e2e script", () => {
    test("suggests the install and the script, with the app's package manager", async ({ dir }) => {
      await aProject(dir);

      const answer = await testsAdd(dir);

      expect(answer.data?.next_commands).toEqual([
        `npm --prefix ${dir} install`,
        `npm --prefix ${dir} run test:e2e`,
      ]);
    });

    test("says to install Playwright's Chromium in the app, which no suggested command may do", async ({
      dir,
    }) => {
      await aProject(dir);

      const answer = await testsAdd(dir);

      expect(answer.data?.next_actions).toEqual([
        `Install Playwright's Chromium once, in ${dir}: npx playwright install chromium`,
      ]);
    });
  });

  describe("with --force", () => {
    test("replaces a test of the developer's own", async ({ dir }) => {
      await aProject(dir);
      await anOwnTestAt(dir, SIGN_IN_SPEC);

      await testsAdd(dir, "--force");

      expect(await readFile(join(dir, SIGN_IN_SPEC), "utf8")).toContain("loginWithPassword");
    });
  });

  describe("with --dry-run", () => {
    test("writes nothing", async ({ dir }) => {
      await aProject(dir);

      await testsAdd(dir, "--dry-run");

      expect(await pathExists(join(dir, PLAYWRIGHT_CONFIG))).toBe(false);
    });
  });
});
