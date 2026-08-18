import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { PatchContext } from "../../../../../../src/lib/orca/patchers/types";
import {
  agentsGuidanceSection,
  readmeGuidanceSection,
} from "../../../../../../src/lib/orca/patchers/rule/guidance";
import { reactRenderer } from "../../../../../../src/lib/orca/patchers/rule/next/renderers/react";
import {
  appVueTemplate,
  authPluginTemplate,
  componentsPluginTemplate,
  indexPageTemplate,
  loginPageTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "../../../../../../src/lib/orca/patchers/rule/nuxt/templates";

/**
 * Guard against guidance/template drift from the real package surfaces: every
 * `@zitadel/*` specifier the scaffold emits into a user's app — page imports,
 * type references, and the AGENTS/README guidance prose — must resolve in the
 * named workspace package's `exports` map. The packages ship as one lockstep
 * train and the scaffold pins the SDK at the CLI's own version, so an emitted
 * subpath that the workspace does not export is guidance pointing at a module
 * that will never resolve (the bug class: `@zitadel/sdk-next/session` cited a
 * train before the export shipped). Runtime skew between an app's older pin
 * and a newer CLI is the `dependency-version` doctor check's concern; this
 * test pins the authoring side.
 */

const WORKSPACE_ROOT = resolve(process.cwd(), "../..");

/** Workspace directory per emitted package name; extend as templates grow. */
const PACKAGE_DIRS: Record<string, string> = {
  "@zitadel/api": "packages/api",
  "@zitadel/cli": "apps/cli",
  "@zitadel/components": "packages/components",
  "@zitadel/config": "packages/config",
  "@zitadel/sdk-core": "packages/sdk-core",
  "@zitadel/sdk-next": "packages/sdk-next",
  "@zitadel/sdk-nuxt": "packages/sdk-nuxt",
};

const SPECIFIER_PATTERN = /@zitadel\/[a-z0-9-]+(?:\/[a-z0-9-]+)*/g;

function baseContext(frameworkId: string, overrides: Partial<PatchContext> = {}): PatchContext {
  return {
    framework: { id: frameworkId, appDir: "app", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.17",
    ...overrides,
  } as PatchContext;
}

/** Every emitted text surface, across the knobs that change what is emitted. */
function emittedCorpus(): string[] {
  const corpus: string[] = [];
  const postures = [undefined, "page", "widget"] as const;
  const useCases = [undefined, "business"] as const;
  for (const posture of postures) {
    for (const useCase of useCases) {
      const pageContext = { useCase, posture };
      corpus.push(reactRenderer.templates.authPage("login", pageContext).contents);
      corpus.push(reactRenderer.templates.authPage("register", pageContext).contents);
      corpus.push(reactRenderer.templates.profilePage!(pageContext).contents);
      const nuxtCtx = baseContext("nuxt", { posture, useCase });
      corpus.push(loginPageTemplate(nuxtCtx));
      corpus.push(registerPageTemplate(nuxtCtx));
      corpus.push(profilePageTemplate(nuxtCtx));
    }
  }
  corpus.push(reactRenderer.templates.customElementsDts!().contents);
  corpus.push(appVueTemplate(), indexPageTemplate(), componentsPluginTemplate(), authPluginTemplate());
  for (const frameworkId of ["next", "nuxt", "react"]) {
    for (const posture of postures) {
      for (const preset of ["password-first", "passkey-first"]) {
        const ctx = baseContext(frameworkId, { posture, preset });
        corpus.push(agentsGuidanceSection(ctx));
        corpus.push(readmeGuidanceSection(ctx));
      }
    }
  }
  return corpus;
}

/**
 * The subpaths a package's manifest exports: normalized `exports` keys, or
 * `undefined` for a legacy manifest without an `exports` map (every subpath
 * resolves through the filesystem there, so nothing can be asserted).
 */
function exportedSubpaths(packageDir: string): Set<string> | undefined {
  const manifest = JSON.parse(
    readFileSync(join(WORKSPACE_ROOT, packageDir, "package.json"), "utf8"),
  ) as { exports?: unknown };
  if (typeof manifest.exports === "string") {
    return new Set(["."]);
  }
  if (manifest.exports === undefined || manifest.exports === null) {
    return undefined;
  }
  return new Set(Object.keys(manifest.exports as Record<string, unknown>));
}

describe("emitted @zitadel specifiers", () => {
  it("resolve in the workspace packages' export maps", () => {
    expect(existsSync(join(WORKSPACE_ROOT, "pnpm-workspace.yaml"))).toBe(true);
    const specifiers = new Set(emittedCorpus().flatMap((text) => text.match(SPECIFIER_PATTERN) ?? []));
    expect(specifiers.size).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      const [scope, name, ...rest] = specifier.split("/");
      const packageName = `${scope}/${name}`;
      const packageDir = PACKAGE_DIRS[packageName];
      // An unmapped package name is itself a finding: either a typo in a
      // template or a package this map must learn about.
      expect(packageDir, `unknown emitted package ${packageName}`).toBeDefined();
      const subpaths = exportedSubpaths(packageDir!);
      if (subpaths === undefined) {
        continue; // legacy manifest without exports — nothing to pin
      }
      const subpath = rest.length === 0 ? "." : `./${rest.join("/")}`;
      expect(
        subpaths.has(subpath),
        `${specifier} is emitted into scaffolded apps but ${packageName} does not export "${subpath}"`,
      ).toBe(true);
    }
  });
});
