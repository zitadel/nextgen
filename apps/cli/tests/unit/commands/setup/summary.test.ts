import { describe, expect } from "vitest";

import {
  detectProjectFacts,
  formatFrameworkLine,
  relativeDisplayPath,
  signInOf,
  summarySections,
} from "@/commands/setup/summary";
import type { ScaffoldedProvider } from "@/lib/zitadel";
import { it } from "@tests/helpers/fixtures";
import { writeJson } from "@tests/helpers/local-project";
import { stripAnsi } from "@tests/helpers/run-cli";

/**
 * The schema setup writes, as the summary shows it relative to the project.
 */
const SCHEMA_PATH = ".zitadel/schemas/default-human-user.json";

/**
 * The framework line for a React app whose version the summary cannot read.
 * The separator is dimmed wherever picocolors sees colour support, so the
 * line is compared as plain text.
 */
const REACT_WITHOUT_VERSION = /^React · /;

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
 * Writes a `package.json` declaring `devDependencies` into `dir`.
 *
 * @param dir - The project directory.
 * @param devDependencies - The dependencies it declares, by name.
 * @returns Nothing; the file is written.
 */
async function aPackageJson(dir: string, devDependencies: Record<string, string>): Promise<void> {
  await writeJson(dir, "package.json", { devDependencies });
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

describe("detectProjectFacts", () => {
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
  ] as const)("names %s with the version of %s", async ([framework, dependency, line], { dir }) => {
    await aPackageJson(dir, { [dependency]: "^3.0.1" });

    const facts = await detectProjectFacts(dir, framework);

    expect(formatFrameworkLine({ ...facts, typescript: false })).toMatch(new RegExp(`^${line} `));
  });

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

    const facts = await detectProjectFacts(dir, "react");

    expect(facts.frameworkVersion).toBe(shown);
  });

  it.for(UNVERSIONED_SPECS)("reads no version when the spec is %s", async (spec, { dir }) => {
    await aPackageJson(dir, { react: spec });

    const facts = await detectProjectFacts(dir, "react");

    expect(facts.frameworkVersion).toBeUndefined();
  });

  it.for(UNVERSIONED_SPECS)(
    "names the framework without a version when the spec is %s",
    async (spec, { dir }) => {
      await aPackageJson(dir, { react: spec });

      const facts = await detectProjectFacts(dir, "react");

      expect(stripAnsi(formatFrameworkLine({ ...facts, typescript: false }))).toMatch(
        REACT_WITHOUT_VERSION,
      );
    },
  );
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

describe("summarySections", () => {
  it("keeps the styling of a secondary value as styling, not as text", () => {
    const [section] = summarySections([
      {
        title: "Detected",
        rows: [
          {
            label: "Package",
            value: "@zitadel/sdk-next",
            secondary: "\u001b[36mpackage.json\u001b[39m",
          },
        ],
      },
    ]);

    const [, value] = section?.facts[0] ?? [];
    expect(value).toContain("\u001b[36mpackage.json\u001b[39m");
    expect(value).not.toContain("\\x1b");
  });

  // Setup's report is the one a reader compares with every other command's,
  // so it is stated in the same shape: a heading in the box's own case, no
  // mark on a row, and no second column that only lines up by luck.
  it("states the facts the way every other box states them", () => {
    const sections = summarySections([
      {
        title: "Customize",
        rows: [
          { label: "User schema", value: ".zitadel/schemas/", secondary: "see its README.md" },
          { label: "Login flow", value: ".zitadel/flows/", secondary: "see its README.md" },
        ],
      },
    ]);

    expect(sections).toEqual([
      {
        heading: "Customize",
        facts: [
          ["User schema", ".zitadel/schemas/ (see its README.md)"],
          ["Login flow", ".zitadel/flows/ (see its README.md)"],
        ],
      },
    ]);
  });

  it("leaves out a group nothing was written into", () => {
    expect(
      summarySections([
        { title: "Detected", rows: [{ label: "Framework", value: "Next.js" }] },
        { title: "Installed", rows: [] },
      ]).map((group) => group.heading),
    ).toEqual(["Detected"]);
  });
});
