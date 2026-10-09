import { join } from "node:path";

import { npmDistTagForCliVersion } from "../../../../public-cli";
import { configCandidates } from "../config-paths";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { solidStartConfigEdit } from "./vite-config";
import {
  indexPageTemplate,
  loginPageTemplate,
  middlewareTemplate,
  profilePageTemplate,
  registerPageTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-solid-start";
/**
 * The idiomatic Solid component library that ships the `<ZitadelLogin>` /
 * `<ZitadelLogout>` Solid components the routes render. The server SDK above is
 * plumbing only; the widget comes from here, so a SolidStart app gets the native
 * Solid component (typed props, callback events) rather than the bare element.
 */
const COMPONENT_DEPENDENCY = "@zitadel/sdk-solid";

const VITE_CONFIG_PATHS = configCandidates("vite.config");

/**
 * Rule-based patcher for a SolidStart app. Like Next.js and Nuxt, SolidStart
 * proxies the backend and verifies the session through server middleware — here
 * the `@zitadel/sdk-solid-start` `createNextgenMiddleware` in `src/middleware.ts`,
 * registered via the `solidStart({ middleware })` plugin option in a
 * non-destructive `vite.config.*` edit (SolidStart 2 reads middleware from the
 * Vite plugin, not a top-level `app.config.ts` field). Contributes the
 * landing/login/register/profile file-based routes (the idiomatic
 * `<ZitadelLogin>`/`<ZitadelLogout>` Solid components from `@zitadel/sdk-solid`),
 * the public project-id env var, and both deps.
 */
export class SolidStartPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "solid-start";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      { kind: "write", path: src("middleware.ts"), contents: middlewareTemplate() },
      { kind: "write", path: src("routes/index.tsx"), contents: indexPageTemplate() },
      { kind: "write", path: src("routes/login.tsx"), contents: loginPageTemplate() },
      { kind: "write", path: src("routes/register.tsx"), contents: registerPageTemplate() },
      { kind: "write", path: src("routes/profile.tsx"), contents: profilePageTemplate() },
      {
        kind: "edit",
        path: [...VITE_CONFIG_PATHS],
        edit: solidStartConfigEdit(),
      },
      { kind: "merge-env", path: ".env.example", entries: { VITE_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { VITE_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
      {
        kind: "add-dep",
        name: COMPONENT_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [
      src("middleware.ts"),
      src("routes/index.tsx"),
      src("routes/login.tsx"),
      src("routes/register.tsx"),
      src("routes/profile.tsx"),
    ];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY, COMPONENT_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    return ["vite.config.*"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "SolidStart integration",
      detail:
        "Wrote src/middleware.ts (@zitadel/sdk-solid-start) plus landing/login/register/profile routes using @zitadel/sdk-solid components and wired the middleware via solidStart({ middleware }) in vite.config.*.",
    };
  }
}
