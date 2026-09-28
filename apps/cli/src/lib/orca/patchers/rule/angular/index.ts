import { ZitadelError } from "../../../../errors";
import { isObject, parseJsonObject, setTopLevelJsonKey } from "../../../../json";
import { npmDistTagForCliVersion } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { angularProxyEdit } from "./angular-json";
import { angularRoutesEdit } from "./angular-routes";
import { appComponentTemplate, appTemplateHtml, proxyConfEdit } from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-angular";

/**
 * Adds a `dev: "ng serve"` script only when the project does not already define
 * one. `ng new` ships only a `start` script, but the CLI tells every framework
 * to run `npm run dev` (and `ng serve` reads the proxy + port from
 * `angular.json`). Non-destructive: an existing `dev` script is preserved, so
 * patching a project that already wires its own `dev` leaves it untouched.
 */
function ensureDevScript(source: string | undefined): string {
  if (source === undefined) {
    throw new ZitadelError("E_VALIDATION", "package.json is required to add the dev script", {
      hint: "Run setup from a project that has a package.json.",
    });
  }
  const pkg = parseJsonObject(source, "package.json");
  const scripts = isObject(pkg.scripts) ? pkg.scripts : undefined;
  // Leave an existing dev script untouched, returning the source unchanged so
  // the edit op skips the file instead of reformatting the user's package.json.
  if (scripts?.dev !== undefined) {
    return source;
  }
  // package.json is user-owned: splice only the scripts value; every byte
  // outside it stays untouched.
  return setTopLevelJsonKey(source, "package.json", "scripts", {
    ...(scripts ?? {}),
    dev: "ng serve",
  });
}

/**
 * Rule-based patcher for an Angular app. Inherits the shared `.zitadel/` base
 * files from {@link AbstractRulePatcher} and contributes the managed root
 * component (`app.ts`/`app.html`) that renders the `@zitadel/sdk-angular`
 * widgets, a `proxy.conf.cjs` dev proxy (attaching the project secret from
 * `ZITADEL_PROJECT_SECRET` only to `POST /sessions/exchange`) wired into `angular.json`,
 * and the SDK dep.
 *
 * Unlike React/Vue (whose dev proxy lives in `vite.config.ts`), Angular owns its
 * Vite config, so the proxy is a separate `proxy.conf.cjs` referenced from the
 * `serve` target. In production the same-origin path comes from a platform
 * rewrite or minimal worker (ADR 036); CLI scaffolding for it is tracked in
 * issue #560.
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
        contents: appComponentTemplate(ctx),
      },
      { kind: "write", path: "src/app/app.html", contents: appTemplateHtml(ctx) },
      {
        kind: "edit",
        path: "src/app/app.routes.ts",
        edit: angularRoutesEdit(),
        // Without the auth routes the router bounces /login back to /.
        wiring: "infrastructure",
      },
      {
        kind: "edit",
        path: "proxy.conf.cjs",
        edit: proxyConfEdit(),
        // The transform creates the managed proxy when absent and safely
        // migrates the exact unconditional bearer hook emitted by older CLIs.
        wiring: "infrastructure",
      },
      {
        kind: "edit",
        path: "angular.json",
        edit: angularProxyEdit({ proxyConfig: "proxy.conf.cjs", port: ctx.framework.devPort }),
        // The serve target's proxyConfig is what attaches proxy.conf.cjs —
        // without it the proxy file is inert and auth requests fail.
        wiring: "infrastructure",
      },
      {
        kind: "edit",
        path: "package.json",
        edit: ensureDevScript,
        // Golden-path convenience (`npm run dev`); its absence only warns.
        wiring: "convenience",
      },
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

  protected override infrastructureFiles(_view: PatchView): ReadonlyArray<string> {
    // The dev proxy is the auth request path (it also attaches the project
    // secret); the root component pair is the user's customization surface.
    return ["proxy.conf.cjs"];
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    // These files are touched via `edit` ops eject can't auto-revert: the proxy
    // wired into angular.json, auth paths added to app.routes.ts, and the `dev`
    // script added to package.json.
    return ["angular.json", "src/app/app.routes.ts", "package.json"];
  }

  protected summary(_ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Angular integration",
      detail:
        "Wrote the app root component + proxy.conf.cjs, added auth routes, and wired the /__nextgen dev proxy into angular.json.",
    };
  }
}
