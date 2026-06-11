import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { type ViteSupport, buildViteProxyOp } from "../vite-support";
import { appTemplate } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-vue";

/**
 * Rule-based patcher for a Vite + Vue single-page app. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * managed `src/App.vue` auth entry, a non-destructive `vite.config.ts` merge
 * that adds the `/__nextgen` dev proxy (injecting the project service-key on
 * `/sessions/exchange`), the `VITE_`-prefixed project id, and the SDK dep.
 */
export class VuePatcher extends AbstractRulePatcher implements ViteSupport {
  canPatch(framework: string): boolean {
    return framework === "vue";
  }

  viteProxyOp(devPort: number): FileOp {
    return buildViteProxyOp(devPort);
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      { kind: "write", path: "src/App.vue", contents: appTemplate(), overwrite: true },
      this.viteProxyOp(ctx.framework.devPort),
      { kind: "merge-env", path: ".env.example", entries: { VITE_ZITADEL_PROJECT_ID: "" } },
      { kind: "merge-env", path: ".env.local", entries: { VITE_ZITADEL_PROJECT_ID: ctx.project.id } },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return ["src/App.vue", "vite.config.ts"];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Vue (Vite) integration",
      detail: "Wrote src/App.vue auth entry and merged the /__nextgen dev proxy into vite.config.ts.",
    };
  }
}
