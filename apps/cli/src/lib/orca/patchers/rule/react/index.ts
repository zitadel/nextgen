import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { viteProxyEdit } from "../vite-proxy";
import { appTemplate } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-react";

/**
 * Rule-based patcher for a Vite + React single-page app. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * managed `src/App.tsx` auth entry, a non-destructive `vite.config.ts` merge
 * that adds the `/__nextgen` dev proxy (injecting the project service-key on
 * `/sessions/exchange`), the `VITE_`-prefixed project id, and the SDK dep.
 *
 * Unlike Next.js — whose middleware runs the proxy and token exchange
 * server-side — a SPA has no server, so the dev proxy stands in for
 * `@zitadel/edge-proxy` locally. Production deployments still need that proxy.
 */
export class ReactPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "react";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      { kind: "write", path: "src/App.tsx", contents: appTemplate(), overwrite: true },
      { kind: "edit", path: "vite.config.ts", edit: viteProxyEdit(ctx.framework.devPort) },
      // Vite only exposes VITE_-prefixed vars to client code (import.meta.env).
      { kind: "merge-env", path: ".env.example", entries: { VITE_ZITADEL_PROJECT_ID: "" } },
      { kind: "merge-env", path: ".env.local", entries: { VITE_ZITADEL_PROJECT_ID: ctx.project.id } },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: dependencyVersionForCli(ctx.cliVersion, "alpha"),
      },
    ];
  }

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return ["src/App.tsx", "vite.config.ts"];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "React (Vite) integration",
      detail:
        "Wrote src/App.tsx auth entry and merged the /__nextgen dev proxy into vite.config.ts.",
    };
  }
}

/**
 * Pins the SDK to the CLI's own prerelease tag (e.g. a `0.1.0-alpha.N` CLI
 * installs `@zitadel/sdk-react@alpha`), falling back to a stable range. Mirrors
 * the Next patcher so the two cannot drift.
 */
function dependencyVersionForCli(cliVersion: string, fallback: string): string {
  const prerelease = cliVersion.match(/^\d+\.\d+\.\d+-([0-9A-Za-z]+)(?:[.-]|$)/)?.[1];
  return prerelease ?? fallback;
}
