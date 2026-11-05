import { join } from "node:path";

import { sdkVersionForCli } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { devScriptPortOp } from "../dev-script-port";
import {
  indexRouteTemplate,
  loginRouteTemplate,
  profileRouteTemplate,
  registerRouteTemplate,
  startTemplate,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-tanstack-start";

/**
 * Rule-based patcher for a TanStack Start app. Like Next.js and SvelteKit,
 * TanStack Start proxies the backend and verifies the session through a server
 * entrypoint — here the `@zitadel/sdk-tanstack-start` request middleware
 * registered in `src/start.ts`. Contributes the landing/login/register/profile
 * file-based routes (rendering the typed `<ZitadelLogin>`/`<ZitadelSession>`
 * React wrappers), the public project-id env var, and the SDK dep. No config
 * edit is needed — `src/start.ts` is a plain file, so (like Next) every managed
 * file carries the marker.
 */
export class TanStackStartPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "tanstack-start";
  }

  protected devPortOps(ctx: PatchContext): FileOp[] {
    return [devScriptPortOp(ctx.issuer, { strictPort: true })];
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      // The auth boundary is written on every setup; a pre-existing start entry
      // at this exact path (e.g. another auth provider's src/start.ts) is a
      // genuine conflict the file-writer refuses (and --force replaces), the
      // same way Next writes its request boundary.
      { kind: "write", path: src("start.ts"), contents: startTemplate() },
      // The landing page is written only when setup created the skeleton
      // itself — a pre-existing app keeps its own landing page (ADR 044),
      // same as the Next/Nuxt homepage.
      ...(ctx.scaffoldedFramework
        ? ([
            { kind: "write", path: src("routes/index.tsx"), contents: indexRouteTemplate() },
          ] satisfies FileOp[])
        : []),
      { kind: "write", path: src("routes/login.tsx"), contents: loginRouteTemplate(ctx) },
      { kind: "write", path: src("routes/register.tsx"), contents: registerRouteTemplate(ctx) },
      { kind: "write", path: src("routes/profile.tsx"), contents: profileRouteTemplate() },
      // Pin the dev script to the origin setup registered; --strictPort makes
      // Vite exit instead of drifting to a port the project does not allow.
      devScriptPortOp(ctx.issuer, { strictPort: true }),
      { kind: "merge-env", path: ".env.example", entries: { VITE_ZITADEL_PROJECT_ID: "" } },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { VITE_ZITADEL_PROJECT_ID: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: sdkVersionForCli(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    const src = (rel: string) => join(view.framework.appDir, rel);
    return [
      src("start.ts"),
      src("routes/index.tsx"),
      src("routes/login.tsx"),
      src("routes/register.tsx"),
      src("routes/profile.tsx"),
    ];
  }

  protected override infrastructureFiles(view: PatchView): ReadonlyArray<string> {
    // The auth boundary — proxy, session check and route protection — is
    // infrastructure: without it /__nextgen/* 404s and protected routes open, so
    // doctor fails rather than warning about a missing page.
    return [join(view.framework.appDir, "start.ts")];
  }

  protected override conditionallyScaffoldedFiles(view: PatchView): ReadonlyArray<string> {
    // Written only when setup created the app skeleton itself; on a
    // pre-existing app the landing page stays user-owned (see routeOps), so
    // the managed-files check must not expect it on a manifest-less app.
    return [join(view.framework.appDir, "routes/index.tsx")];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    // The dev script's port is pinned in place by an `edit` op eject can't
    // revert, so it is listed as a manual cleanup step.
    return ["package.json"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "TanStack Start integration",
      detail:
        "Wrote src/start.ts (@zitadel/sdk-tanstack-start request middleware) plus landing/login/register/profile routes.",
    };
  }
}
