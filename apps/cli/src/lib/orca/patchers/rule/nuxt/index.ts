import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { nuxtConfigEdit } from "./nuxt-config";
import {
  appVueTemplate,
  authPluginTemplate,
  componentsPluginTemplate,
  loginPageTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-nuxt";

const NUXT_CONFIG_PATHS = ["nuxt.config.ts", "nuxt.config.mjs", "nuxt.config.js"] as const;

/**
 * Rule-based patcher for a Nuxt app. Like Next.js, Nuxt proxies the backend and
 * verifies the session through server middleware — here the `@zitadel/sdk-nuxt`
 * module, registered via a non-destructive `nuxt.config.ts` edit. Contributes
 * the login/register/profile pages (the raw `<zitadel-login>`/`<zitadel-logout>`
 * elements), the client/server plugins, the `app.vue` router, and the SDK dep.
 */
export class NuxtPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "nuxt";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      { kind: "write", path: "app.vue", contents: appVueTemplate(), overwrite: true },
      { kind: "write", path: "pages/login.vue", contents: loginPageTemplate() },
      { kind: "write", path: "pages/register.vue", contents: registerPageTemplate() },
      { kind: "write", path: "pages/profile.vue", contents: profilePageTemplate() },
      {
        kind: "write",
        path: "plugins/zitadel-components.client.ts",
        contents: componentsPluginTemplate(),
      },
      { kind: "write", path: "plugins/auth.server.ts", contents: authPluginTemplate() },
      {
        kind: "edit",
        path: [...NUXT_CONFIG_PATHS],
        edit: nuxtConfigEdit({ projectId: ctx.project.id, server: ctx.server }),
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
        version: dependencyVersionForCli(ctx.cliVersion, "alpha"),
      },
    ];
  }

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return [
      "app.vue",
      "pages/login.vue",
      "pages/register.vue",
      "pages/profile.vue",
      "plugins/zitadel-components.client.ts",
      "plugins/auth.server.ts",
    ];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Nuxt integration",
      detail:
        "Wrote login/register/profile pages + plugins and registered @zitadel/sdk-nuxt in nuxt.config.ts.",
    };
  }
}

function dependencyVersionForCli(cliVersion: string, fallback: string): string {
  const prerelease = cliVersion.match(/^\d+\.\d+\.\d+-([0-9A-Za-z]+)(?:[.-]|$)/)?.[1];
  return prerelease ?? fallback;
}
