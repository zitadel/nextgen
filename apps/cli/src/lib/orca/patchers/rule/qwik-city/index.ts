import { join } from "node:path";

import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import {
  indexPageTemplate,
  loginPageTemplate,
  pluginTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-qwik-city";

/**
 * Rule-based patcher for a Qwik City app. Like Next.js and SvelteKit, Qwik City
 * proxies the backend and verifies the session through a server entrypoint —
 * here the `@zitadel/sdk-qwik-city` `onRequest` plugin in
 * `src/routes/plugin@nextgen.ts`. Contributes the landing/login/register/profile
 * file-based routes (the raw `<zitadel-login>`/`<zitadel-logout>` elements
 * registered client-side), the public project-id env var, and the SDK dep. No
 * config edit is needed — the plugin is a plain route file, so (like Next)
 * every managed file carries the marker.
 */
export class QwikCityPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "qwik-city";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      { kind: "write", path: src("routes/plugin@nextgen.ts"), contents: pluginTemplate() },
      { kind: "write", path: src("routes/index.tsx"), contents: indexPageTemplate() },
      { kind: "write", path: src("routes/login/index.tsx"), contents: loginPageTemplate() },
      { kind: "write", path: src("routes/register/index.tsx"), contents: registerPageTemplate() },
      { kind: "write", path: src("routes/profile/index.tsx"), contents: profilePageTemplate() },
      { kind: "merge-env", path: ".env.example", entries: { PUBLIC_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        // Qwik City's generated `vite.config.ts` rejects any `dependencies`
        // entry whose name matches `/qwik/i` (`errorOnDuplicatesPkgDeps`),
        // forcing Qwik-ecosystem packages into `devDependencies` where Qwik
        // bundles them into the server build. `@zitadel/sdk-qwik-city` matches,
        // so it must be a devDependency or the app fails to build.
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
        dev: true,
      },
    ];
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [
      src("routes/plugin@nextgen.ts"),
      src("routes/index.tsx"),
      src("routes/login/index.tsx"),
      src("routes/register/index.tsx"),
      src("routes/profile/index.tsx"),
    ];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Qwik City integration",
      detail:
        "Wrote src/routes/plugin@nextgen.ts (@zitadel/sdk-qwik-city onRequest) plus landing/login/register/profile routes.",
    };
  }
}
