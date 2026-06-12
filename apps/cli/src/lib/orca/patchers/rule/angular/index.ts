import { isObject, parseJsonObject, stableStringify } from "../../../../json";
import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { angularProxyEdit } from "./angular-json";
import { appComponentTemplate, appTemplateHtml, proxyConfTemplate } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-angular";

/**
 * Adds a `dev: "ng serve"` script only when the project does not already define
 * one. `ng new` ships only a `start` script, but the CLI tells every framework
 * to run `npm run dev` (and `ng serve` reads the proxy + port from
 * `angular.json`). Non-destructive: an existing `dev` script is preserved, so
 * patching a project that already wires its own `dev` leaves it untouched.
 */
function ensureDevScript(source: string | undefined): string {
  const pkg: Record<string, unknown> = source ? parseJsonObject(source, "package.json") : {};
  const scripts: Record<string, unknown> = isObject(pkg.scripts) ? { ...pkg.scripts } : {};
  if (scripts.dev === undefined) {
    scripts.dev = "ng serve";
  }
  pkg.scripts = scripts;
  return `${stableStringify(pkg)}\n`;
}

/**
 * Rule-based patcher for an Angular app. Inherits the shared `.zitadel/` base
 * files from {@link AbstractRulePatcher} and contributes the managed root
 * component (`app.ts`/`app.html`) that renders the `@zitadel/sdk-angular`
 * widgets, a `proxy.conf.cjs` dev proxy (attaching the `sk_<project_id>` bearer
 * to every proxied request) wired into `angular.json`, and the SDK dep.
 *
 * Unlike React/Vue (whose dev proxy lives in `vite.config.ts`), Angular owns its
 * Vite config, so the proxy is a separate `proxy.conf.cjs` referenced from the
 * `serve` target. Production still needs `@zitadel/edge-proxy`.
 */
export class AngularPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "angular";
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      {
        kind: "write",
        path: "src/app/app.ts",
        contents: appComponentTemplate(ctx.project.id),
      },
      { kind: "write", path: "src/app/app.html", contents: appTemplateHtml() },
      { kind: "write", path: "proxy.conf.cjs", contents: proxyConfTemplate() },
      {
        kind: "edit",
        path: "angular.json",
        edit: angularProxyEdit({ proxyConfig: "proxy.conf.cjs", port: ctx.framework.devPort }),
      },
      { kind: "edit", path: "package.json", edit: ensureDevScript },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: npmDistTagForCliVersion(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return ["src/app/app.ts", "src/app/app.html", "proxy.conf.cjs"];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    return ["angular.json"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Angular integration",
      detail:
        "Wrote the app root component + proxy.conf.cjs and wired the /__nextgen dev proxy into angular.json.",
    };
  }
}
