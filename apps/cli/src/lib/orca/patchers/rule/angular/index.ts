import { sdkVersionForCli } from "@/lib/public-cli";
import type { FileOp } from "@/lib/orca/patchers/rule/file-writer/types";
import type { PatchContext, PatchView } from "@/lib/orca/patchers/types";
import { AbstractRulePatcher } from "@/lib/orca/patchers/rule/base";
import {
  angularEntry,
  assertMountsRootComponent,
  type RootMount,
} from "@/lib/orca/patchers/rule/root-component";
import { angularDefineGuardEdit, angularProxyEdit } from "./angular-json";
import { angularRoutesEdit } from "./angular-routes";
import {
  appComponentProjectIdEdit,
  appComponentProjectIdVerdict,
  appComponentTemplate,
  appTemplateHtml,
  devScriptEdit,
  LAUNCHER_PATH,
  launcherEdit,
  launcherScriptsEdit,
  launcherScriptsVerdict,
  PROJECT_ID_GUARD,
  proxyConfApiPrefixEdit,
  proxyConfApiPrefixVerdict,
  proxyConfEdit,
  proxyConfSessionCookieEdit,
  proxyConfSessionCookieVerdict,
} from "./templates";

const SDK_DEPENDENCY = "@zitadel/sdk-angular";

/**
 * The managed root component, in the layout Angular 20 generates, and how
 * `main.ts` bootstraps it. Angular 17–19 keep theirs in `app.component.ts`,
 * and a module-based app bootstraps an `AppModule`.
 */
const ROOT: RootMount = {
  path: "src/app/app.ts",
  binding: { name: "App", named: true },
  extension: false,
  calls: ["bootstrapApplication", "bootstrapModule"],
  mounts: "argument",
};

/**
 * Rule-based patcher for an Angular app. Inherits the shared `.zitadel/` base
 * files from {@link AbstractRulePatcher} and contributes the managed root
 * component (`app.ts`/`app.html`) that renders the `@zitadel/sdk-angular`
 * widgets, a `proxy.conf.cjs` dev proxy (attaching the project secret from
 * `ZITADEL_PROJECT_SECRET` only to `POST /sessions/exchange`) wired into `angular.json`,
 * the `zitadel-ng.cjs` launcher the `ng serve`/`ng build` scripts run through
 * (it defines the client's project id from `ZITADEL_PROJECT_ID`), and the SDK dep.
 *
 * Unlike React/Vue (whose dev proxy lives in `vite.config.ts`), Angular owns its
 * Vite config, so the proxy is a separate `proxy.conf.cjs` referenced from the
 * `serve` target. In production the same-origin path comes from a platform
 * rewrite or minimal worker (ADR 036).
 */
export class AngularPatcher extends AbstractRulePatcher {
  canPatch(framework: string): boolean {
    return framework === "angular";
  }

  protected override async preflight(_ctx: PatchContext, cwd: string): Promise<void> {
    await assertMountsRootComponent(cwd, await angularEntry(cwd), ROOT);
  }

  protected devPortOps(ctx: PatchContext, previousPort: number | undefined): FileOp[] {
    return [
      {
        kind: "edit",
        path: "angular.json",
        edit: angularProxyEdit({
          proxyConfig: "proxy.conf.cjs",
          port: ctx.framework.devPort,
          previousPort,
        }),
      },
    ];
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return [
      {
        kind: "write",
        path: ROOT.path,
        contents: appComponentTemplate(ctx),
      },
      {
        kind: "edit",
        path: ROOT.path,
        edit: appComponentProjectIdEdit(ctx),
        // A component an earlier CLI wrote names the project it was set up
        // against, while its proxy reads ZITADEL_PROJECT_ID: it still signs in,
        // so the doctor only warns until `doctor --fix` moves it.
        wiring: "convenience",
        verify: appComponentProjectIdVerdict(ctx.project.id),
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
        path: "proxy.conf.cjs",
        edit: proxyConfSessionCookieEdit(),
        // A session cookie per project (ADR 073) keeps the Console and the app
        // from signing each other out on localhost. Sign-in works without it,
        // so the doctor only warns while it is missing.
        wiring: "convenience",
        verify: proxyConfSessionCookieVerdict,
      },
      {
        kind: "edit",
        path: "proxy.conf.cjs",
        edit: proxyConfApiPrefixEdit(),
        // The packages call the API under /api/v1 (ADR 077), and a v2 proxy
        // attaches the project secret only to the exchange at the root, so
        // sign-in fails: the doctor fails until `doctor --fix` moves it to v3.
        wiring: "infrastructure",
        verify: proxyConfApiPrefixVerdict,
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
        path: LAUNCHER_PATH,
        edit: launcherEdit,
        // The launcher defines the client's project id: without it the
        // scripts that run it fail.
        wiring: "infrastructure",
      },
      {
        kind: "edit",
        path: "package.json",
        edit: launcherScriptsEdit,
        // `ng serve` or `ng build` run without the launcher leave the client
        // without its project id, so the doctor fails until `doctor --fix`.
        wiring: "infrastructure",
        verify: launcherScriptsVerdict,
      },
      {
        kind: "edit",
        path: "angular.json",
        edit: angularDefineGuardEdit(PROJECT_ID_GUARD),
        // Makes a plain `ng serve` or `ng build` stop with what to run
        // instead; the app works without it, so the doctor only warns.
        wiring: "convenience",
      },
      {
        kind: "edit",
        path: "package.json",
        edit: devScriptEdit,
        // Golden-path convenience (`npm run dev`); its absence only warns.
        wiring: "convenience",
      },
      {
        kind: "add-dep",
        name: SDK_DEPENDENCY,
        version: sdkVersionForCli(ctx.cliVersion),
      },
    ];
  }

  protected routeFiles(_view: PatchView): ReadonlyArray<string> {
    return [ROOT.path, "src/app/app.html", "proxy.conf.cjs", LAUNCHER_PATH];
  }

  protected override infrastructureFiles(_view: PatchView): ReadonlyArray<string> {
    // The dev proxy is the auth request path (it also attaches the project
    // secret), and the launcher gives the client its project id; the root
    // component pair is the user's customization surface.
    return ["proxy.conf.cjs", LAUNCHER_PATH];
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
        "Wrote the app root component and proxy.conf.cjs, added auth routes, and wired the /__nextgen dev proxy into angular.json.",
    };
  }
}
