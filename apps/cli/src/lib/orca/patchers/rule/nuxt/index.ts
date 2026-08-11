import { join } from "node:path";

import { npmDistTagForCliVersion } from "../../../../public-cli";
import { configCandidates } from "../config-paths";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { nuxtConfigEdit } from "./nuxt-config";
import {
  appVueTemplate,
  authPluginTemplate,
  componentsPluginTemplate,
  indexPageTemplate,
  loginPageTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-nuxt";

const NUXT_CONFIG_PATHS = configCandidates("nuxt.config");

/**
 * Rule-based patcher for a Nuxt app. Like Next.js, Nuxt proxies the backend and
 * verifies the session through server middleware — here the `@zitadel/sdk-nuxt`
 * module, registered via a non-destructive `nuxt.config.*` edit. Contributes
 * the login/register/profile pages (the raw `<zitadel-login>`/`<zitadel-logout>`
 * elements), the client/server plugins, the `app.vue` router, and the SDK dep.
 */
export class NuxtPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "nuxt";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      // app.vue/pages/plugins live under the Nuxt srcDir (`app/` on Nuxt 4, the
      // root on Nuxt 3); nuxt.config, env, and the dep stay at the project root.
      // The app shell and homepage redirect are written only when setup created
      // the skeleton itself — a pre-existing app keeps its own shell, theme,
      // and landing page (ADR 044), same as the Next homepage.
      ...(ctx.scaffoldedFramework
        ? ([
            { kind: "write", path: src("app.vue"), contents: appVueTemplate() },
            { kind: "write", path: src("pages/index.vue"), contents: indexPageTemplate() },
          ] satisfies FileOp[])
        : []),
      { kind: "write", path: src("pages/login.vue"), contents: loginPageTemplate(ctx) },
      { kind: "write", path: src("pages/register.vue"), contents: registerPageTemplate(ctx) },
      { kind: "write", path: src("pages/profile.vue"), contents: profilePageTemplate(ctx) },
      {
        kind: "write",
        path: src("plugins/zitadel-components.client.ts"),
        contents: componentsPluginTemplate(),
      },
      { kind: "write", path: src("plugins/auth.server.ts"), contents: authPluginTemplate() },
      {
        kind: "edit",
        path: [...NUXT_CONFIG_PATHS],
        edit: nuxtConfigEdit({ projectId: ctx.project.id, server: ctx.server }),
        // Runtime config + proxy wiring: auth breaks without it.
        wiring: "infrastructure",
      },
      { kind: "merge-env", path: ".env.example", entries: { NUXT_PUBLIC_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { NUXT_PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [
      src("app.vue"),
      src("pages/index.vue"),
      src("pages/login.vue"),
      src("pages/register.vue"),
      src("pages/profile.vue"),
      src("plugins/zitadel-components.client.ts"),
      src("plugins/auth.server.ts"),
    ];
  }

  protected override infrastructureFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    // The plugins are the auth plumbing: component registration on the
    // client and the server-side auth/session hook. The pages and app shell
    // are the user's customization surface.
    return [src("plugins/zitadel-components.client.ts"), src("plugins/auth.server.ts")];
  }

  protected override conditionallyScaffoldedFiles(view: PatchView): ReadonlyArray<string> {
    // Written only when setup created the app skeleton itself; on a
    // pre-existing app the shell and homepage stay user-owned (see routeOps).
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [src("app.vue"), src("pages/index.vue")];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    return ["nuxt.config.*"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Nuxt integration",
      detail:
        "Wrote login/register/profile pages + plugins and registered @zitadel/sdk-nuxt in nuxt.config.*.",
    };
  }
}
