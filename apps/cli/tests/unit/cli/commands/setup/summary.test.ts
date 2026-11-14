import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  relativeDisplayPath,
  type SetupAnswers,
  scaffoldOf,
  signInOf,
} from "@/cli/commands/setup/shared";
import type { InitialCommitOutcome } from "@/cli/commands/setup/steps/make-initial-commit";
import { ShowResult } from "@/cli/commands/setup/steps/show-result";
import type { CommandResult } from "@/lib/oclif";
import { path as stylePath } from "@/lib/style";
import { type Section, Ui } from "@/lib/ui";
import type { ScaffoldedProvider } from "@/lib/zitadel";
import { it } from "@tests/helpers/fixtures";
import { writeJson } from "@tests/helpers/local-project";
import { stripAnsi } from "@tests/helpers/run-cli";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * The schema setup writes, as the summary shows it relative to the project.
 */
const SCHEMA_PATH = ".zitadel/schemas/default-human-user.json";

/**
 * Google, chosen from the catalog.
 */
const GOOGLE: ScaffoldedProvider = { selection: { kind: "catalog", id: "google" } };

/**
 * The version ranges that name no version the summary could show.
 */
const UNVERSIONED_SPECS = [
  "catalog:",
  "workspace:*",
  "file:../react",
  "link:../react",
  "latest",
  "canary",
  "next",
  "*",
  "github:facebook/react",
  "npm:react@^18.0.0",
];

/**
 * What setup's answers hold for a password-first app on a local server, on port 3000.
 */
const ANSWERS: SetupAnswers = {
  server: "http://localhost:8080",
  devPort: 3000,
  preset: "password-first",
  useCase: "minimal",
  sso: [],
  passwordMinLength: 15,
};

/**
 * What sign-in is configured to do for {@link ANSWERS}.
 */
const SIGN_IN = {
  starts_with: "password",
  methods: ["password", "passkey"],
  fields: [
    { name: "email", required: true },
    { name: "givenName", required: false },
  ],
  password_min_length: 15,
  providers: [],
} as const;

/**
 * The project setup created.
 */
const PROJECT = {
  id: "proj_test",
  name: "demo",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_test_preview",
  origins: [],
  created_at: "2026-06-01T00:00:00.000Z",
};

/**
 * What the commit step reports for each way it can end, and what the result says of it.
 */
const GIT_REPORTS: ReadonlyArray<
  readonly [string, InitialCommitOutcome, { initialized: boolean; commit: string | null }]
> = [
  [
    "a repository setup created and committed into",
    { kind: "created", sha: "abc", guessedIdentity: false, invented: false },
    { initialized: true, commit: "abc" },
  ],
  [
    "a commit into a repository that already existed",
    { kind: "committed", sha: "abc", guessedIdentity: false, invented: false },
    { initialized: false, commit: "abc" },
  ],
  [
    "a repository setup created even when its commit failed",
    { kind: "unavailable", reason: "r", createdRepository: true },
    { initialized: true, commit: null },
  ],
  [
    "no repository and no commit when the commit failed in an existing one",
    { kind: "unavailable", reason: "r", createdRepository: false },
    { initialized: false, commit: null },
  ],
  ["nothing when setup skipped git", { kind: "skipped" }, { initialized: false, commit: null }],
];

/**
 * What {@link ShowResult} reads.
 */
type Needs = Parameters<ShowResult["run"]>[0];

/**
 * Writes a `package.json` declaring `devDependencies` into `dir`.
 *
 * @param dir - The project directory.
 * @param devDependencies - The dependencies it declares, by name.
 * @returns Nothing; the file is written.
 */
async function aPackageJson(dir: string, devDependencies: Record<string, string>): Promise<void> {
  await writeJson(dir, "package.json", { devDependencies });
}

/**
 * Words the result of a setup that wrote `overrides` into the project in `dir`.
 *
 * @param dir - The project directory.
 * @param overrides - What the run came to know, where it differs from a plain Next.js app.
 * @returns The result the command answers with.
 */
async function resultFor(dir: string, overrides: Partial<Needs> = {}): Promise<CommandResult> {
  const suggest = aSuggest({}, "1.2.3");
  const { answer } = await new ShowResult({
    cliVersion: "1.2.3",
    cwd: dir,
    dryRun: false,
    isJson: false,
    realRun: () => {
      return Promise.resolve(suggest({ id: "setup" }));
    },
    suggest,
    ui: new Ui({ interactive: true, force: false }),
  }).run({
    allFilesWritten: [],
    answers: ANSWERS,
    app: { framework: "next", devPort: 3000 },
    commit: { kind: "skipped" },
    deployment: undefined,
    found: {
      app: { framework: "next", devPort: 3000 },
      detected: undefined,
      scaffoldedBesideFiles: false,
    },
    hostsPlatform: false,
    installOutcome: {
      install: { status: "not-needed", package_manager: "npm", command: "npm install" },
      devCommand: "npm run dev",
      boxActions: [],
      nextActions: [],
      nextCommands: [],
    },
    isLocal: false,
    issuer: "http://localhost:3000",
    ownedByLocalAdmin: undefined,
    patched: { dryRun: false, files: [], filesWritten: [], filesSkipped: [], depsAdded: [] },
    planned: await scaffoldOf(dir, false, ANSWERS),
    project: PROJECT,
    scaffoldedFramework: false,
    signIn: SIGN_IN,
    ssoOutcomes: new Map(),
    ...overrides,
  });
  return answer;
}

/**
 * The sections of the summary a result draws.
 *
 * @param answer - The result.
 * @returns The sections, empty when the result draws none.
 */
function sectionsOf(answer: CommandResult): ReadonlyArray<Section> {
  return "summary" in answer && answer.summary !== undefined ? answer.summary.sections : [];
}

/**
 * The facts a summary section holds, as they read without colour.
 *
 * @param answer - The result.
 * @param heading - The section's heading.
 * @returns Each fact's label and value.
 */
function factsOf(answer: CommandResult, heading: string): ReadonlyArray<readonly [string, string]> {
  return (sectionsOf(answer).find((section) => section.heading === heading)?.facts ?? []).map(
    ([label, value]) => {
      return [label, stripAnsi(value)] as const;
    },
  );
}

/**
 * The framework line of the summary a result draws, as it reads without colour.
 *
 * @param answer - The result.
 * @returns The line, empty when the summary has none.
 */
function frameworkLineOf(answer: CommandResult): string {
  return (
    factsOf(answer, "Detected").find(([label]) => {
      return label === "Framework";
    })?.[1] ?? ""
  );
}

describe("relativeDisplayPath", () => {
  it("gives a Windows path under the cwd with forward slashes", () => {
    const displayed = relativeDisplayPath(
      "C:\\repo",
      "C:\\repo\\.zitadel\\schemas\\default-human-user.json",
    );

    expect(displayed).toBe(SCHEMA_PATH);
  });

  it("does not strip a sibling path that merely shares the cwd prefix", () => {
    const displayed = relativeDisplayPath("C:\\repo", "C:\\repository\\file.json");

    expect(displayed).toBe("C:/repository/file.json");
  });
});

describe("ShowResult", () => {
  describe("the framework line", () => {
    it.for([
      ["next", "next", "Next.js 3.0.1"],
      ["nuxt", "nuxt", "Nuxt 3.0.1"],
      ["react", "react", "React 3.0.1"],
      ["vue", "vue", "Vue 3.0.1"],
      ["angular", "@angular/core", "Angular 3.0.1"],
      ["solid", "solid-js", "Solid 3.0.1"],
      ["svelte", "svelte", "Svelte 3.0.1"],
      ["sveltekit", "@sveltejs/kit", "SvelteKit 3.0.1"],
      ["solid-start", "@solidjs/start", "SolidStart 3.0.1"],
      ["qwik-router", "@qwik.dev/router", "Qwik Router 3.0.1"],
      ["tanstack-start", "@tanstack/react-start", "TanStack Start 3.0.1"],
      ["qwik", "@qwik.dev/core", "Qwik 3.0.1"],
    ] as const)(
      "names %s with the version of %s",
      async ([framework, dependency, line], { dir }) => {
        await aPackageJson(dir, { [dependency]: "^3.0.1" });

        const answer = await resultFor(dir, { app: { framework, devPort: 3000 } });

        expect(frameworkLineOf(answer)).toBe(`${line} · npm`);
      },
    );

    it.for([
      ["20.1.x", "20.1.0"],
      ["^18.0.0||^19.0.0", "18.0.0"],
      ["^18.0.0 || ^19.0.0", "18.0.0"],
      [">=18 <20", "18.0.0"],
      ["~3.0.1", "3.0.1"],
      ["~ 3.0.1", "3.0.1"],
      [">= 18.0.0", "18.0.0"],
      ["^ 18.0.0", "18.0.0"],
      ["=18.3.1", "18.3.1"],
      ["v18.3.1", "18.3.1"],
      ["19.0.0-rc.1", "19.0.0-rc.1"],
    ] as const)("shows the first version of the valid range %s", async ([spec, shown], { dir }) => {
      await aPackageJson(dir, { react: spec });

      const answer = await resultFor(dir, { app: { framework: "react", devPort: 3000 } });

      expect(frameworkLineOf(answer)).toBe(`React ${shown} · npm`);
    });

    it.for(UNVERSIONED_SPECS)(
      "names the framework without a version when the spec is %s",
      async (spec, { dir }) => {
        await aPackageJson(dir, { react: spec });

        const answer = await resultFor(dir, { app: { framework: "react", devPort: 3000 } });

        expect(frameworkLineOf(answer)).toBe("React · npm");
      },
    );

    it("adds TypeScript when the project has a tsconfig", async ({ dir }) => {
      await writeJson(dir, "tsconfig.json", {});

      const answer = await resultFor(dir);

      expect(frameworkLineOf(answer)).toBe("Next.js · TypeScript · npm");
    });
  });

  describe("the Detected section", () => {
    it.each([
      {
        situation: "a scaffold, without claiming the directory was empty",
        scaffoldedBesideFiles: false,
        value: "new project",
      },
      {
        situation: "a scaffold --force put over files the directory already held",
        scaffoldedBesideFiles: true,
        value: "new project over existing files (--force)",
      },
    ])("describes $situation", async ({ scaffoldedBesideFiles, value }) => {
      const answer = await resultFor("", {
        scaffoldedFramework: true,
        found: {
          app: { framework: "next", devPort: 3000 },
          detected: undefined,
          scaffoldedBesideFiles,
        },
      });

      expect(factsOf(answer, "Detected")).toContainEqual(["Scaffold", value]);
    });

    it("has no scaffold row for an app that already existed", async ({ dir }) => {
      const answer = await resultFor(dir);

      expect(
        factsOf(answer, "Detected").map(([label]) => {
          return label;
        }),
      ).not.toContain("Scaffold");
    });
  });

  describe("the Sign-in section", () => {
    it("says what sign-in enables and which registration fields are optional", async ({ dir }) => {
      const answer = await resultFor(dir);

      expect(sectionsOf(answer)).toContainEqual({
        heading: "Sign-in",
        facts: [
          ["Starts with", "password"],
          ["Methods", "password, passkey"],
          ["Registration", "email, givenName (optional)"],
          ["Passwords", "at least 15 characters"],
        ],
      });
    });
  });

  describe("the Customize section", () => {
    it("points at each customizable folder setup wrote, the password policy included", async ({
      dir,
    }) => {
      const answer = await resultFor(dir, {
        allFilesWritten: [
          ".zitadel/schemas/default-human-user.json",
          ".zitadel/flows/default-login.json",
          ".zitadel/policies/auth.factor.password.set.json",
        ].map((file) => {
          return join(dir, file);
        }),
      });

      expect(
        factsOf(answer, "Customize").map(([label]) => {
          return label;
        }),
      ).toEqual(["User schema", "Login flow", "Password policy"]);
    });

    // Setup's report is the one a reader compares with every other command's,
    // so it is stated in the same shape: a heading in the box's own case, no
    // mark on a row, and no second column that only lines up by luck.
    it("states the facts the way every other box states them", async ({ dir }) => {
      const answer = await resultFor(dir, {
        allFilesWritten: [
          ".zitadel/schemas/default-human-user.json",
          ".zitadel/flows/default-login.json",
        ].map((file) => {
          return join(dir, file);
        }),
      });

      expect(factsOf(answer, "Customize")).toEqual([
        ["User schema", ".zitadel/schemas/ (see its README.md)"],
        ["Login flow", ".zitadel/flows/ (see its README.md)"],
      ]);
    });
  });

  describe("a row's secondary value", () => {
    it("keeps the styling as styling, not as text", async ({ dir }) => {
      const answer = await resultFor(dir, {
        allFilesWritten: [join(dir, "package.json")],
        patched: {
          dryRun: false,
          files: [],
          filesWritten: [],
          filesSkipped: [],
          depsAdded: ["@zitadel/sdk-next"],
        },
      });

      const [, value] =
        sectionsOf(answer)
          .find((section) => section.heading === "Installed")
          ?.facts.find(([label]) => label === "Package") ?? [];
      expect(value).toContain(stylePath("package.json"));
      expect(value).not.toContain("\\x1b");
    });
  });

  describe("a group nothing was written into", () => {
    it("is left out", async ({ dir }) => {
      const answer = await resultFor(dir);

      expect(
        sectionsOf(answer).map((section) => {
          return section.heading;
        }),
      ).toEqual(["Detected", "Sign-in", "Project"]);
    });
  });

  describe("the report of the commit", () => {
    it.for(GIT_REPORTS)("reports %s", async ([, commit, report], { dir }) => {
      const answer = await resultFor(dir, { commit });

      expect(answer).toMatchObject({ data: { git: report } });
    });
  });
});

describe("signInOf", () => {
  it("reports both methods for password-first, which the preset name does not say", () => {
    const signIn = signInOf({
      preset: "password-first",
      useCase: "minimal",
      sso: [],
      passwordMinLength: null,
    });

    expect(signIn).toEqual({
      starts_with: "password",
      methods: ["password", "passkey"],
      fields: [{ name: "email", required: true }],
      password_min_length: null,
      providers: [],
    });
  });

  it("says passkey-first starts with a passkey", () => {
    const signIn = signInOf({ preset: "passkey-first", useCase: "minimal", sso: [] });

    expect(signIn.starts_with).toBe("passkey");
  });

  it("marks the consumer use case's name fields optional", () => {
    const signIn = signInOf({ preset: "password-first", useCase: "consumer", sso: [] });

    expect(signIn.fields).toEqual([
      { name: "email", required: true },
      { name: "givenName", required: false },
      { name: "familyName", required: false },
    ]);
  });

  it("reports the recommended minimum when none was given, which setup then writes", () => {
    const signIn = signInOf({ preset: "password-first", useCase: "minimal", sso: [] });

    expect(signIn.password_min_length).toBe(15);
  });

  describe("with a provider selected", () => {
    it("names the provider by slug", () => {
      const signIn = signInOf({ preset: "password-first", useCase: "minimal", sso: [GOOGLE] });

      expect(signIn.providers).toEqual(["google"]);
    });

    it("enables sso, as the schema setup publishes does", () => {
      const signIn = signInOf({ preset: "password-first", useCase: "minimal", sso: [GOOGLE] });

      expect(signIn.methods).toEqual(["password", "passkey", "sso"]);
    });
  });
});
