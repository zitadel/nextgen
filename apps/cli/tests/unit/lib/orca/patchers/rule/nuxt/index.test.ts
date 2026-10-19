import { describe, expect, it } from "vitest";

import { FRAMEWORK_IDS } from "../../../../../../helpers/framework-ids";
import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { NuxtPatcher } from "../../../../../../../src/lib/orca/patchers/rule/nuxt";
import { LEGACY_COMPONENTS_PLUGIN } from "../../../../../../../src/lib/orca/patchers/rule/nuxt/templates";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "app", scaffoldedFramework = true): PatchContext {
  return {
    framework: { id: "nuxt", appDir, devPort: 3000, url: "http://localhost:3000" },
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
    cliVersion: "0.1.0-alpha.0",
    scaffoldedFramework,
  };
}

function writeContents(plan: ScaffoldPlan, path: string): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  return op?.contents;
}

describe("NuxtPatcher.plan", () => {
  it("writes the managed app + pages under the Nuxt 4 app/ srcDir", () => {
    const plan = new NuxtPatcher().plan(ctx("app"));
    expect(writeContents(plan, "app/app.vue")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/pages/login.vue")).toContain(MANAGED_MARKER);
    // Page chrome comes from the widget itself now — the wrapper only pins
    // the color scheme, and no token hex is duplicated into generated code.
    expect(writeContents(plan, "app/pages/login.vue")).toContain('variant="page"');
    expect(writeContents(plan, "app/pages/login.vue")).not.toContain("background: #0f0f11");
    expect(writeContents(plan, "app/pages/login.vue")).toContain("color-scheme: dark");
    expect(writeContents(plan, "app/pages/login.vue")).not.toContain("background: #f3f4f6");
    expect(writeContents(plan, "app/pages/login.vue")).not.toContain("align-items: center");
    // The embedding alternative is named where a developer will see it.
    expect(writeContents(plan, "app/pages/login.vue")).toContain('variant="widget"');
    expect(writeContents(plan, "app/plugins/zitadel-components.client.ts")).toContain(
      MANAGED_MARKER,
    );
    const edit = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "edit" }> =>
        op.kind === "edit" && String(op.path).includes("nuxt.config"),
    );
    // nuxt.config stays at the project root, not under app/.
    expect(edit?.path).toContain("nuxt.config.ts");
  });

  it("wires the business copy overlay for business-use-case projects", () => {
    // Minimal scaffolds keep the widget's neutral built-in copy.
    expect(writeContents(new NuxtPatcher().plan(ctx()), "app/pages/login.vue")).not.toContain(
      "businessLocales",
    );
    const business = new NuxtPatcher().plan({ ...ctx(), useCase: "business" });
    for (const path of ["app/pages/login.vue", "app/pages/register.vue"]) {
      const page = writeContents(business, path);
      // The page takes the overlay from the client plugin rather than
      // importing the components, and a plain :locales binding suffices even
      // on the raw custom element — Vue sets bindings whose key exists on the
      // element as DOM properties (no React-18 ref detour as in Next).
      expect(page).toContain("const { $zitadelBusinessLocales: businessLocales } = useNuxtApp();");
      expect(page).toContain(':locales="businessLocales"');
    }
    // Consumer scaffolds keep the neutral built-ins, like minimal ones.
    const consumer = new NuxtPatcher().plan({ ...ctx(), useCase: "consumer" });
    expect(writeContents(consumer, "app/pages/login.vue")).not.toContain("businessLocales");
  });

  it("leaves profile page chrome to the session card's page surface", () => {
    const plan = new NuxtPatcher().plan(ctx("app"));
    const profile = writeContents(plan, "app/pages/profile.vue");
    expect(profile).toContain('variant="page"');
    // The card paints its own full-page chrome from design tokens — no
    // duplicated token hex or forced viewport height in generated markup.
    expect(profile).not.toContain("#0f0f11");
    expect(profile).not.toContain("min-height: 100vh");
    expect(profile).toContain("color-scheme: dark");
    expect(profile).toContain('variant="widget"');
  });

  it("writes at the root for a Nuxt 4 root-layout project (appDir '.')", () => {
    const plan = new NuxtPatcher().plan(ctx("."));
    expect(writeContents(plan, "app.vue")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "pages/login.vue")).toContain(MANAGED_MARKER);
  });

  it("keeps a pre-existing app's shell and homepage (ADR 044)", () => {
    // Only fresh scaffolds get the CLI's app.vue and the /login redirect —
    // writing them into an existing app would stomp (or conflict with) the
    // user's own shell, theme, and landing page.
    const plan = new NuxtPatcher().plan(ctx("app", false));
    expect(writeContents(plan, "app/app.vue")).toBeUndefined();
    expect(writeContents(plan, "app/pages/index.vue")).toBeUndefined();
    expect(writeContents(plan, "app/pages/login.vue")).toContain(MANAGED_MARKER);
  });

  it("embeds widget cards with theme=auto for the widget posture (ADR 044)", () => {
    const plan = new NuxtPatcher().plan({ ...ctx("app", false), posture: "widget" });
    for (const path of ["app/pages/login.vue", "app/pages/register.vue", "app/pages/profile.vue"]) {
      const page = writeContents(plan, path);
      expect(page).toContain('variant="widget"\n        theme="auto"');
      // Layout-neutral wrapper: no forced color scheme, the host app's own
      // shell provides the chrome.
      expect(page).not.toContain("color-scheme: dark");
      expect(page).toContain("justify-content: center");
      // The full-page alternative stays named for discoverability.
      expect(page).toContain('variant="page"');
    }
  });

  it("treats absent posture as the page posture (legacy restores)", () => {
    const dflt = new NuxtPatcher().plan(ctx("app", false));
    const paged = new NuxtPatcher().plan({ ...ctx("app", false), posture: "page" });
    for (const path of ["app/pages/login.vue", "app/pages/register.vue", "app/pages/profile.vue"]) {
      expect(writeContents(paged, path)).toBe(writeContents(dflt, path));
    }
  });

  it.each(["@zitadel/sdk-nuxt", "@zitadel/components"])(
    "adds %s at the CLI's exact version",
    (name) => {
      const dep = new NuxtPatcher()
        .plan(ctx())
        .ops.find(
          (op): op is Extract<FileOp, { kind: "add-dep" }> =>
            op.kind === "add-dep" && op.name === name,
        );
      expect(dep).toMatchObject({ version: "0.1.0-alpha.0" });
    },
  );

  it("declares the components package the client plugin imports", () => {
    const plan = new NuxtPatcher().plan(ctx());
    expect(writeContents(plan, "app/plugins/zitadel-components.client.ts")).toContain(
      'import "@zitadel/components";',
    );
  });

  it("provides the business overlay from the client plugin", () => {
    const plan = new NuxtPatcher().plan({ ...ctx(), useCase: "business" });
    expect(writeContents(plan, "app/plugins/zitadel-components.client.ts")).toContain(
      "provide: { zitadelBusinessLocales: businessLocales }",
    );
  });

  it("lists the plugin bytes older CLIs wrote, so --fix can refresh an unedited copy", () => {
    const actions = new NuxtPatcher().artifacts({
      framework: ctx().framework,
      rendererId: ctx().rendererId,
    });
    expect(actions.outdatedContents).toEqual({
      "app/plugins/zitadel-components.client.ts": [LEGACY_COMPONENTS_PLUGIN],
    });
  });

  it("leaves seeding the auth state to the module's own plugin", () => {
    const plan = new NuxtPatcher().plan(ctx());
    expect(writeContents(plan, "app/plugins/auth.server.ts")).toBeUndefined();
  });

  it.each([
    ["minimal page", undefined, "page"],
    ["minimal widget", undefined, "widget"],
    ["business page", "business", "page"],
    ["business widget", "business", "widget"],
  ] as const)("keeps the %s pages free of @zitadel imports", (_label, useCase, posture) => {
    const plan = new NuxtPatcher().plan({ ...ctx(), useCase, posture });
    for (const path of ["app/pages/login.vue", "app/pages/register.vue", "app/pages/profile.vue"]) {
      expect(writeContents(plan, path)).not.toContain('from "@zitadel/');
    }
  });
});

describe("NuxtPatcher.artifacts", () => {
  it("lists the srcDir pages as managed and the Nuxt config as a manual config edit", () => {
    const artifacts = new NuxtPatcher().artifacts({
      framework: { id: "nuxt", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("app/pages/login.vue");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-nuxt", "@zitadel/components"]);
    // package.json is listed too: the `dev` script gets the registered
    // dev-server port pinned into it, and eject can't auto-revert that.
    expect(artifacts.configEdits).toEqual(["nuxt.config.*", "package.json"]);
  });

  it("declares the app shell and homepage as conditionally scaffolded", () => {
    // Written only on fresh scaffolds, so the managed-files check must not
    // expect them on a manifest-less pre-existing app.
    const artifacts = new NuxtPatcher().artifacts({
      framework: { id: "nuxt", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.conditionalFiles).toEqual(
      expect.arrayContaining(["app/app.vue", "app/pages/index.vue"]),
    );
  });

  it("still ejects the auth plugin an older setup wrote, without expecting it", () => {
    const artifacts = new NuxtPatcher().artifacts({
      framework: { id: "nuxt", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("app/plugins/auth.server.ts");
    expect(artifacts.conditionalFiles).toContain("app/plugins/auth.server.ts");
  });
});

describe("NuxtPatcher.canPatch", () => {
  it.each(FRAMEWORK_IDS)("matches %s only when it is its own framework", (id) => {
    expect(new NuxtPatcher().canPatch(id)).toBe(id === "nuxt");
  });
});
