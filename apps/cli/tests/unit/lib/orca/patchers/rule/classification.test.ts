import { describe, expect, it } from "vitest";

import type { FrameworkFacts } from "../../../../../../src/lib/orca/detectors/types";
import { AngularPatcher } from "../../../../../../src/lib/orca/patchers/rule/angular";
import { NextPatcher } from "../../../../../../src/lib/orca/patchers/rule/next";
import { NuxtPatcher } from "../../../../../../src/lib/orca/patchers/rule/nuxt";
import { QwikPatcher } from "../../../../../../src/lib/orca/patchers/rule/qwik";
import { QwikRouterPatcher } from "../../../../../../src/lib/orca/patchers/rule/qwik-router";
import { ReactPatcher } from "../../../../../../src/lib/orca/patchers/rule/react";
import { SolidPatcher } from "../../../../../../src/lib/orca/patchers/rule/solid";
import { SolidStartPatcher } from "../../../../../../src/lib/orca/patchers/rule/solid-start";
import { SveltePatcher } from "../../../../../../src/lib/orca/patchers/rule/svelte";
import { SvelteKitPatcher } from "../../../../../../src/lib/orca/patchers/rule/sveltekit";
import { TanStackStartPatcher } from "../../../../../../src/lib/orca/patchers/rule/tanstack-start";
import { VuePatcher } from "../../../../../../src/lib/orca/patchers/rule/vue";
import type { Patcher } from "../../../../../../src/lib/orca/patchers/types";

function facts(id: string, appDir: string): FrameworkFacts {
  return { id, appDir, devPort: 3000, url: "http://localhost:3000", versionMajor: 16 };
}

/**
 * The doctor managed-files check trusts each patcher's ownership
 * classification: a missing infrastructure file fails, a missing
 * presentation file warns. These cases pin the classification per patcher
 * so a framework whose auth plumbing silently defaults to `presentation`
 * (warn-only, `ok: true` with a broken auth path) is a test failure, not a
 * production surprise.
 */
const PATCHERS: Array<{
  patcher: Patcher;
  view: { framework: FrameworkFacts; rendererId: string };
}> = [
  { patcher: new NextPatcher(), view: { framework: facts("next", "app"), rendererId: "react" } },
  { patcher: new NuxtPatcher(), view: { framework: facts("nuxt", "app"), rendererId: "react" } },
  {
    patcher: new AngularPatcher(),
    view: { framework: facts("angular", "src"), rendererId: "react" },
  },
  { patcher: new ReactPatcher(), view: { framework: facts("react", "src"), rendererId: "react" } },
  { patcher: new VuePatcher(), view: { framework: facts("vue", "src"), rendererId: "react" } },
  { patcher: new SolidPatcher(), view: { framework: facts("solid", "src"), rendererId: "react" } },
  {
    patcher: new SveltePatcher(),
    view: { framework: facts("svelte", "src"), rendererId: "react" },
  },
  { patcher: new QwikPatcher(), view: { framework: facts("qwik", "src"), rendererId: "react" } },
  {
    patcher: new SvelteKitPatcher(),
    view: { framework: facts("sveltekit", "src"), rendererId: "react" },
  },
  {
    patcher: new SolidStartPatcher(),
    view: { framework: facts("solid-start", "src"), rendererId: "react" },
  },
  {
    patcher: new QwikRouterPatcher(),
    view: { framework: facts("qwik-router", "src"), rendererId: "react" },
  },
  {
    patcher: new TanStackStartPatcher(),
    view: { framework: facts("tanstack-start", "src"), rendererId: "react" },
  },
];

describe("patcher file classification", () => {
  it.each(PATCHERS.map(({ patcher, view }) => [view.framework.id, patcher, view] as const))(
    "%s classifies every marked file",
    (_id, patcher, view) => {
      const actions = patcher.artifacts(view);
      expect(actions.fileClasses).toBeDefined();
      for (const path of actions.markedFiles) {
        expect(actions.fileClasses![path]).toMatch(/^(infrastructure|presentation)$/);
      }
    },
  );

  it("Next marks the boundary and type declarations as infrastructure", () => {
    const actions = new NextPatcher().artifacts({
      framework: facts("next", "app"),
      rendererId: "react",
    });
    expect(actions.fileClasses!["proxy.ts"]).toBe("infrastructure");
    expect(actions.fileClasses!["custom-elements.d.ts"]).toBe("infrastructure");
    expect(actions.fileClasses!["app/login/page.tsx"]).toBe("presentation");
  });

  it("Angular marks the secret-attaching dev proxy as infrastructure", () => {
    const actions = new AngularPatcher().artifacts({
      framework: facts("angular", "src"),
      rendererId: "react",
    });
    expect(actions.fileClasses!["proxy.conf.cjs"]).toBe("infrastructure");
    expect(actions.fileClasses!["src/app/app.ts"]).toBe("presentation");
    expect(actions.fileClasses!["src/app/app.html"]).toBe("presentation");
  });

  it("Nuxt has no infrastructure files: the SDK module owns the plumbing", () => {
    const actions = new NuxtPatcher().artifacts({
      framework: facts("nuxt", "app"),
      rendererId: "react",
    });
    expect(Object.values(actions.fileClasses!)).not.toContain("infrastructure");
    expect(actions.fileClasses!["app/pages/login.vue"]).toBe("presentation");
  });

  it("Vite SPAs keep their root component as presentation (plumbing lives in config edits)", () => {
    for (const { patcher, view } of PATCHERS.filter(({ view }) =>
      ["react", "vue", "solid", "svelte", "qwik"].includes(view.framework.id),
    )) {
      const actions = patcher.artifacts(view);
      const classes = Object.values(actions.fileClasses!);
      expect(classes).not.toContain("infrastructure");
      expect(actions.configEdits.length).toBeGreaterThan(0);
    }
  });

  // The meta-frameworks' auth boundary (proxy, session check, route guard) is
  // a plain file; losing it breaks auth, so doctor must fail, not warn.
  it.each([
    ["sveltekit", "src/hooks.server.ts"],
    ["solid-start", "src/middleware.ts"],
    ["qwik-router", "src/routes/plugin@nextgen.ts"],
    ["tanstack-start", "src/start.ts"],
  ])("%s marks its auth boundary %s as infrastructure", (id, boundary) => {
    const { patcher, view } = PATCHERS.find((entry) => entry.view.framework.id === id)!;

    expect(patcher.artifacts(view).fileClasses![boundary]).toBe("infrastructure");
  });
});
