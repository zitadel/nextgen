import { sdkVersionForCli } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { PUBLIC_PROJECT_ID_VARIABLE } from "../public-project-id";
import { assertMountsRootComponent, type RootMount, viteEntry } from "../root-component";
import { type ViteSupport, buildViteProxyOp, buildViteSessionCookieOp } from "../vite-support";
import { appTemplate } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-vue";

/** The managed root component, and how `main.ts` creates the app from it. */
const ROOT: RootMount = {
  path: "src/App.vue",
  binding: { name: "App", named: false },
  extension: true,
  calls: ["createApp", "createSSRApp"],
  mounts: "argument",
};

/**
 * Rule-based patcher for a Vite + Vue single-page app. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * managed `src/App.vue` auth entry, a non-destructive `vite.config.*` merge
 * that adds the `/__nextgen` dev proxy (attaching the project secret from
 * `ZITADEL_PROJECT_SECRET` only to `POST /sessions/exchange`), the `VITE_`-prefixed
 * project id, and the SDK dep.
 */
export class VuePatcher extends AbstractRulePatcher implements ViteSupport {
  canPatch(framework: string): boolean {
    return framework === "vue";
  }

  viteProxyOp(devPort: number, server: string, previousPort?: number): FileOp {
    return buildViteProxyOp(devPort, server, previousPort);
  }

  viteSessionCookieOp(): FileOp {
    return buildViteSessionCookieOp();
  }

  protected override async preflight(_ctx: PatchContext, cwd: string): Promise<void> {
    await assertMountsRootComponent(cwd, await viteEntry(cwd), ROOT);
  }

  protected devPortOps(ctx: PatchContext, previousPort: number | undefined): FileOp[] {
    return [this.viteProxyOp(ctx.framework.devPort, ctx.server, previousPort)];
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      { kind: "write", path: ROOT.path, contents: appTemplate(ctx) },
      this.viteProxyOp(ctx.framework.devPort, ctx.server),
      this.viteSessionCookieOp(),
      {
        kind: "merge-env",
        path: ".env.example",
        entries: { [PUBLIC_PROJECT_ID_VARIABLE.vue]: "" },
      },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: { [PUBLIC_PROJECT_ID_VARIABLE.vue]: ctx.project.id },
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: sdkVersionForCli(ctx.cliVersion),
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
      title: "Vue (Vite) integration",
      detail:
        "Wrote src/App.vue auth entry and merged the /__nextgen dev proxy into vite.config.*.",
    };
  }
}
