import { describe, expect } from "vitest";

import {
  detectProjectFacts,
  formatFrameworkLine,
  relativeDisplayPath,
  signInOf,
  signInSummary,
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
 * The sign-in setup configures for the password-first preset and the minimal
 * use case, with no provider.
 */
const PASSWORD_FIRST = signInOf({ preset: "password-first", useCase: "minimal", sso: [] });

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

describe("signInSummary", () => {
  it("says what password-first enables and what registration asks for", () => {
    const signIn = signInOf({
      preset: "password-first",
      useCase: "consumer",
      sso: [],
      passwordMinLength: null,
    });

    const summary = signInSummary(signIn, []);

    expect(summary).toBe(
      [
        "Users see email and password first; passkeys are enabled but not shown at sign-in.",
        "Password and passkey are enabled in the user schema.",
        "Registration requires email; givenName and familyName are optional.",
        "Passwords have no minimum length.",
        "No external providers will be added.",
      ].join("\n"),
    );
  });

  it("says passkey-first shows a passkey first, with email and password as the alternative", () => {
    const signIn = signInOf({ preset: "passkey-first", useCase: "minimal", sso: [] });

    const summary = signInSummary(signIn, []);

    expect(summary).toContain(
      "Users see a passkey first, with email and password as the alternative.",
    );
  });

  it("leaves out the optional clause when every field is required", () => {
    const summary = signInSummary(PASSWORD_FIRST, []);

    expect(summary).toContain("Registration requires email.");
  });

  it("says the minimum password length", () => {
    const summary = signInSummary(PASSWORD_FIRST, []);

    expect(summary).toContain("Passwords need at least 15 characters.");
  });

  describe("with providers selected", () => {
    it("names them", () => {
      const summary = signInSummary(PASSWORD_FIRST, ["Google", "Acme SSO"]);

      expect(summary).toContain("External providers: Google, Acme SSO.");
    });

    it("does not say no providers will be added", () => {
      const summary = signInSummary(PASSWORD_FIRST, ["Google", "Acme SSO"]);

      expect(summary).not.toContain("No external providers");
    });
  });
});
