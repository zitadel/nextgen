import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectProjectFacts,
  formatFrameworkLine,
  relativeDisplayPath,
  signInOf,
} from "@/commands/setup/summary";
import { stripAnsi } from "@tests/helpers/run-cli";
import { summarySections } from "@/commands/setup/summary";

describe("relativeDisplayPath", () => {
  it("normalizes Windows paths for repository-style suffix matching", () => {
    const displayed = relativeDisplayPath(
      "C:\\repo",
      "C:\\repo\\.zitadel\\schemas\\default-human-user.json",
    );

    expect(displayed).toBe(".zitadel/schemas/default-human-user.json");
    expect(displayed.endsWith(".zitadel/schemas/default-human-user.json")).toBe(true);
  });

  it("does not strip a sibling path that merely shares the cwd prefix", () => {
    expect(relativeDisplayPath("C:\\repo", "C:\\repository\\file.json")).toBe(
      "C:/repository/file.json",
    );
  });
});

describe("detectProjectFacts", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function app(devDependencies: Record<string, string>): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "summary-facts-"));
    dirs.push(cwd);
    await writeFile(join(cwd, "package.json"), JSON.stringify({ devDependencies }));
    return cwd;
  }

  // The version comes from the framework's own package, not its CLI id.
  it.each([
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
  ])("names %s with the version of %s", async (framework, dependency, line) => {
    const facts = await detectProjectFacts(await app({ [dependency]: "^3.0.1" }), framework);

    expect(formatFrameworkLine({ ...facts, typescript: false })).toMatch(new RegExp(`^${line} `));
  });

  it.each([
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
  ])("shows the first version of the valid range %s", async (spec, shown) => {
    const facts = await detectProjectFacts(await app({ react: spec }), "react");

    expect(facts.frameworkVersion).toBe(shown);
  });

  it.each([
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
  ])("prints no version when the spec is %s", async (spec) => {
    const facts = await detectProjectFacts(await app({ react: spec }), "react");

    expect(facts.frameworkVersion).toBeUndefined();
    // The separator is dimmed wherever picocolors sees colour support (CI is
    // set and NO_COLOR is not, as in ci-turbo), so compare the plain text.
    expect(stripAnsi(formatFrameworkLine({ ...facts, typescript: false }))).toMatch(/^React · /);
  });
});

describe("signInOf", () => {
  it("reports both methods for password-first, which the preset name does not say", () => {
    expect(
      signInOf({ preset: "password-first", useCase: "minimal", sso: [], passwordMinLength: null }),
    ).toEqual({
      starts_with: "password",
      methods: ["password", "passkey"],
      fields: [{ name: "email", required: true }],
      password_min_length: null,
      providers: [],
    });
  });

  it("says passkey-first starts with a passkey", () => {
    expect(signInOf({ preset: "passkey-first", useCase: "minimal", sso: [] }).starts_with).toBe(
      "passkey",
    );
  });

  it("marks the consumer use case's name fields optional", () => {
    expect(signInOf({ preset: "password-first", useCase: "consumer", sso: [] }).fields).toEqual([
      { name: "email", required: true },
      { name: "givenName", required: false },
      { name: "familyName", required: false },
    ]);
  });

  it("reports the recommended minimum when none was given, which setup then writes", () => {
    expect(
      signInOf({ preset: "password-first", useCase: "minimal", sso: [] }).password_min_length,
    ).toBe(15);
  });

  it("names the selected providers by slug", () => {
    const signIn = signInOf({
      preset: "password-first",
      useCase: "minimal",
      sso: [{ selection: { kind: "catalog", id: "google" } }] as never,
    });
    expect(signIn.providers).toEqual(["google"]);
    // The schema setup publishes enables sso for a chosen provider.
    expect(signIn.methods).toEqual(["password", "passkey", "sso"]);
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
