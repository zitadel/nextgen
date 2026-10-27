import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { PatchContext } from "../../../../../../src/lib/orca/patchers/types";
import {
  agentsGuidanceSection,
  readmeGuidanceSection,
} from "../../../../../../src/lib/orca/patchers/rule/guidance";
import {
  appComponentTemplate,
  appTemplateHtml,
} from "../../../../../../src/lib/orca/patchers/rule/angular/templates";
import { reactRenderer } from "../../../../../../src/lib/orca/patchers/rule/next/renderers/react";
import {
  appVueTemplate,
  indexPageTemplate,
  loginPageTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "../../../../../../src/lib/orca/patchers/rule/nuxt/templates";
import { appTemplate as qwikAppTemplate } from "../../../../../../src/lib/orca/patchers/rule/qwik/templates";
import { appTemplate as reactAppTemplate } from "../../../../../../src/lib/orca/patchers/rule/react/templates";
import { appTemplate as solidAppTemplate } from "../../../../../../src/lib/orca/patchers/rule/solid/templates";
import { appTemplate as svelteAppTemplate } from "../../../../../../src/lib/orca/patchers/rule/svelte/templates";
import { appTemplate as vueAppTemplate } from "../../../../../../src/lib/orca/patchers/rule/vue/templates";
import { detectors } from "../../../../../../src/lib/orca/detectors";
import { createOrca } from "../../../../../../src/lib/orca";
import type { AbstractRulePatcher } from "../../../../../../src/lib/orca/patchers/rule/base";
import { FRAMEWORK_IDS } from "../../../../../helpers/framework-ids";

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
  "@zitadel/sdk-angular": "packages/sdk-angular",
  "@zitadel/sdk-core": "packages/sdk-core",
  "@zitadel/sdk-next": "packages/sdk-next",
  "@zitadel/sdk-nuxt": "packages/sdk-nuxt",
  "@zitadel/sdk-qwik": "packages/sdk-qwik",
  "@zitadel/sdk-qwik-router": "packages/sdk-qwik-router",
  "@zitadel/sdk-react": "packages/sdk-react",
  "@zitadel/sdk-solid": "packages/sdk-solid",
  "@zitadel/sdk-solid-start": "packages/sdk-solid-start",
  "@zitadel/sdk-svelte": "packages/sdk-svelte",
  "@zitadel/sdk-sveltekit": "packages/sdk-sveltekit",
  "@zitadel/sdk-tanstack-start": "packages/sdk-tanstack-start",
  "@zitadel/sdk-vue": "packages/sdk-vue",
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
      origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.17",
    ...overrides,
  } as PatchContext;
}

/** The root-component template each single-page-app patcher emits. */
const SPA_ROOT_TEMPLATES: Record<string, (ctx: PatchContext) => string> = {
  react: reactAppTemplate,
  vue: vueAppTemplate,
  solid: solidAppTemplate,
  svelte: svelteAppTemplate,
  qwik: qwikAppTemplate,
  angular: appComponentTemplate,
};

/** Every framework a patcher exists for, taken from the detector registry. */
const ALL_FRAMEWORK_IDS = detectors.map((detector) => detector.framework);

/**
 * What one framework's patcher plans for the knobs that change it: the files it
 * writes and the packages it adds. Read from the plan itself, so a framework
 * cannot be left out of the corpus by a hand-kept list.
 */
function plannedByFramework(frameworkId: string) {
  const patcher = createOrca().patcherFor(frameworkId) as AbstractRulePatcher;
  const writes: string[] = [];
  const dependencies = new Set<string>();
  for (const posture of [undefined, "page", "widget"] as const) {
    for (const useCase of [undefined, "business"] as const) {
      const ctx = baseContext(frameworkId, { posture, useCase, scaffoldedFramework: true });
      for (const op of patcher.plan(ctx).ops) {
        if (op.kind === "write") {
          writes.push(op.contents);
        } else if (op.kind === "add-dep") {
          dependencies.add(op.name);
        }
      }
    }
  }
  return { writes, dependencies };
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
      for (const [frameworkId, template] of Object.entries(SPA_ROOT_TEMPLATES)) {
        corpus.push(template(baseContext(frameworkId, { posture, useCase })));
      }
      corpus.push(appTemplateHtml(baseContext("angular", { posture, useCase })));
    }
  }
  corpus.push(reactRenderer.templates.customElementsDts!().contents);
  corpus.push(appVueTemplate(), indexPageTemplate());
  for (const frameworkId of ALL_FRAMEWORK_IDS) {
    corpus.push(...plannedByFramework(frameworkId).writes);
  }
  for (const frameworkId of FRAMEWORK_IDS) {
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
    const specifiers = new Set(
      emittedCorpus().flatMap((text) => text.match(SPECIFIER_PATTERN) ?? []),
    );
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

  // Apps go through their SDK. `@zitadel/components` is the SDK's own dependency, so no
  // scaffold adds it or imports it, whatever the framework.
  it.each(ALL_FRAMEWORK_IDS)("%s adds its SDK and never @zitadel/components", (frameworkId) => {
    const { writes, dependencies } = plannedByFramework(frameworkId);
    expect(dependencies.size).toBeGreaterThan(0);
    expect(dependencies).not.toContain("@zitadel/components");
    for (const name of dependencies) {
      expect(name).toMatch(/^@zitadel\/sdk-/);
    }
    for (const contents of writes) {
      expect(contents).not.toMatch(/["']@zitadel\/components["']/);
    }
  });
});
