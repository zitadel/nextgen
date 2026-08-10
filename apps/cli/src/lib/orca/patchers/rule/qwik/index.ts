import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { type ViteSupport, buildViteProxyOp } from "../vite-support";
import { appTemplate } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-qwik";

/**
 * Rule-based patcher for a Vite + Qwik single-page app. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * managed `src/app.tsx` auth entry, a non-destructive `vite.config.*` merge
 * that adds the `/__nextgen` dev proxy (attaching the project secret from
 * `ZITADEL_PROJECT_SECRET` only to `POST /sessions/exchange`), the `VITE_`-prefixed
 * project id, and the SDK dep.
 *
 * The create-vite Qwik template uses a lowercase `src/app.tsx` exporting a named
 * `App` (mounted by `main.tsx`), so this patcher writes that exact entry. Unlike
 * Next.js — whose middleware runs the proxy server-side — a SPA has no server,
 * so the dev proxy provides the same-origin `/__nextgen` path locally. In
 * production that path comes from a platform rewrite or minimal worker
 * (ADR 036); CLI scaffolding for it is tracked in issue #560.
 */
export class QwikPatcher extends AbstractRulePatcher implements ViteSupport {
  canPatch(framework: string): boolean {
    return framework === "qwik";
  }

  viteProxyOp(devPort: number, server: string): FileOp {
    return buildViteProxyOp(devPort, server);
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      { kind: "write", path: "src/app.tsx", contents: appTemplate(ctx) },
      this.viteProxyOp(ctx.framework.devPort, ctx.server),
      // Vite only exposes VITE_-prefixed vars to client code (import.meta.env).
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

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return ["src/app.tsx"];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    return ["vite.config.*"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Qwik (Vite) integration",
      detail:
        "Wrote src/app.tsx auth entry and merged the /__nextgen dev proxy into vite.config.*.",
    };
  }
}
