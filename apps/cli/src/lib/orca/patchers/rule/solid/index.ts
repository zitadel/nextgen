import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { PUBLIC_PROJECT_ID_VARIABLE } from "../public-project-id";
import { assertMountsRootComponent, type RootMount, viteEntry } from "../root-component";
import { type ViteSupport, buildViteProxyOp } from "../vite-support";
import { appTemplate } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-solid";

/** The managed root component, and how `index.tsx` renders it. */
const ROOT: RootMount = {
  path: "src/App.tsx",
  binding: { name: "App", named: false },
  extension: true,
  calls: ["render", "hydrate"],
  mounts: "jsx",
};

/**
 * Rule-based patcher for a Vite + Solid single-page app. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * managed `src/App.tsx` auth entry, a non-destructive `vite.config.*` merge
 * that adds the `/__nextgen` dev proxy (attaching the project secret from
 * `ZITADEL_PROJECT_SECRET` only to `POST /sessions/exchange`), the `VITE_`-prefixed
 * project id, and the SDK dep.
 *
 * Unlike Next.js — whose middleware runs the proxy and token exchange
 * server-side — a SPA has no server, so the dev proxy provides the same-origin
 * `/__nextgen` path locally. In production that path comes from a platform
 * rewrite or minimal worker (ADR 036); CLI scaffolding for it is tracked in
 * issue #560.
 */
export class SolidPatcher extends AbstractRulePatcher implements ViteSupport {
  canPatch(framework: string): boolean {
    return framework === "solid";
  }

  viteProxyOp(devPort: number, server: string): FileOp {
    return buildViteProxyOp(devPort, server);
  }

  protected override async preflight(_ctx: PatchContext, cwd: string): Promise<void> {
    await assertMountsRootComponent(cwd, await viteEntry(cwd), ROOT);
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      { kind: "write", path: ROOT.path, contents: appTemplate(ctx) },
      this.viteProxyOp(ctx.framework.devPort, ctx.server),
      // Vite only exposes VITE_-prefixed vars to client code (import.meta.env).
      {
        kind: "merge-env",
        path: ".env.example",
        entries: { [PUBLIC_PROJECT_ID_VARIABLE.solid]: "" },
      },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { [PUBLIC_PROJECT_ID_VARIABLE.solid]: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return [ROOT.path];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    return ["vite.config.*"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Solid (Vite) integration",
      detail:
        "Wrote src/App.tsx auth entry and merged the /__nextgen dev proxy into vite.config.*.",
    };
  }
}
