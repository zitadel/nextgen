import { join } from "node:path";

import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
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
 * file-based routes (rendering the typed `<ZitadelLogin>`/`<ZitadelLogout>`
 * React wrappers), the public project-id env var, and the SDK dep. No config
 * edit is needed — `src/start.ts` is a plain file, so (like Next) every managed
 * file carries the marker.
 */
export class TanStackStartPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "tanstack-start";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    const src = (rel: string) => join(ctx.framework.appDir, rel);
    return [
      { kind: "write", path: src("start.ts"), contents: startTemplate() },
      { kind: "write", path: src("routes/index.tsx"), contents: indexRouteTemplate() },
      { kind: "write", path: src("routes/login.tsx"), contents: loginRouteTemplate() },
      { kind: "write", path: src("routes/register.tsx"), contents: registerRouteTemplate() },
      { kind: "write", path: src("routes/profile.tsx"), contents: profileRouteTemplate() },
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

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "TanStack Start integration",
      detail:
        "Wrote src/start.ts (@zitadel/sdk-tanstack-start request middleware) plus landing/login/register/profile routes.",
    };
  }
}
