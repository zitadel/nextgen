import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectProjectFacts,
  formatFrameworkLine,
  relativeDisplayPath,
  signInSummary,
} from "../../../../src/commands/setup/summary";
import { stripAnsi } from "../../../helpers/run-cli";

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

describe("signInSummary", () => {
  it("says password-first starts with email and password and enables both methods", () => {
    expect(signInSummary({ preset: "password-first", sso: [] })).toBe(
      [
        "Sign-in starts with email and password.",
        "Password and passkey are enabled in the user schema.",
        "No external providers selected.",
      ].join("\n"),
    );
  });

  it("says passkey-first starts with a passkey and falls back to email and password", () => {
    expect(signInSummary({ preset: "passkey-first", sso: [] })).toContain(
      "Sign-in starts with a passkey, with email and password as the fallback.",
    );
  });

  it("names the selected providers", () => {
    const summary = signInSummary({
      preset: "password-first",
      sso: [
        { selection: { kind: "catalog", id: "google" } },
        {
          selection: {
            kind: "custom",
            connection: {
              slug: "acme-sso",
              displayName: "Acme SSO",
              issuer: "https://sso.acme.example",
              scopes: "openid",
            },
          },
        },
      ] as never,
    });

    expect(summary).toContain("External providers: Google, Acme SSO.");
    expect(summary).not.toContain("No external providers");
  });
});
