import { join } from "node:path";

import { sdkVersionForCli } from "../../../../public-cli";
import { configCandidates } from "../config-paths";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { devScriptPortOp } from "../dev-script-port";
import { nuxtConfigEdit } from "./nuxt-config";
import {
  appVueTemplate,
  componentsPluginTemplate,
  indexPageTemplate,
  loginPageTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-nuxt";
/**
 * The client plugin imports the elements directly, so the app declares them:
 * pnpm and Yarn PnP do not resolve a transitive dependency of the SDK.
 */
const COMPONENTS_DEPENDENCY = "@zitadel/components";

/**
 * Written by setup before `@zitadel/sdk-nuxt`'s own plugin seeded the same
 * auth state. Still listed so eject removes it from older apps, but no
 * longer written.
 */
const RETIRED_AUTH_PLUGIN = "plugins/auth.server.ts";

const NUXT_CONFIG_PATHS = configCandidates("nuxt.config");

/**
 * Rule-based patcher for a Nuxt app. Like Next.js, Nuxt proxies the backend and
 * verifies the session through server middleware — here the `@zitadel/sdk-nuxt`
 * module, registered via a non-destructive `nuxt.config.*` edit. Contributes
 * the login/register/profile pages (the raw `<zitadel-login>`/`<zitadel-session>`
 * elements), the client components plugin, the `app.vue` router, and the deps.
 * The module's own plugin seeds the auth state on the server, so no server
 * plugin is scaffolded.
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
        contents: componentsPluginTemplate(ctx),
      },
      {
        kind: "edit",
        path: [...NUXT_CONFIG_PATHS],
        edit: nuxtConfigEdit(),
        // Module registration + proxy wiring: auth breaks without it.
        wiring: "infrastructure",
      },
      { kind: "merge-env", path: ".env.example", entries: { NUXT_PUBLIC_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { NUXT_PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      { kind: "add-dep", name: SDK_DEPENDENCY, version: sdkVersionForCli(ctx.cliVersion) },
      {
        kind: "add-dep",
        name: COMPONENTS_DEPENDENCY,
        version: sdkVersionForCli(ctx.cliVersion),
      },
      // `nuxt dev` takes its port from the command line only, so without this
      // the app can serve a port the project does not allow as an origin.
      devScriptPortOp(ctx.issuer),
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
      src(RETIRED_AUTH_PLUGIN),
    ];
  }

  protected override infrastructureFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    // The components plugin is the auth plumbing: it registers the elements
    // on the client. The pages and app shell are the user's customization
    // surface.
    return [src("plugins/zitadel-components.client.ts")];
  }

  protected override conditionallyScaffoldedFiles(view: PatchView): ReadonlyArray<string> {
    // Written only when setup created the app skeleton itself; on a
    // pre-existing app the shell and homepage stay user-owned (see routeOps).
    // The retired auth plugin exists only in apps an older setup wrote.
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [src("app.vue"), src("pages/index.vue"), src(RETIRED_AUTH_PLUGIN)];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY, COMPONENTS_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    // package.json: the `dev` script gets the project's dev-server port
    // pinned into it, another in-place edit eject can't auto-revert.
    return ["nuxt.config.*", "package.json"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Nuxt integration",
      detail:
        "Wrote login/register/profile pages + the components plugin and registered @zitadel/sdk-nuxt in nuxt.config.*.",
    };
  }
}
