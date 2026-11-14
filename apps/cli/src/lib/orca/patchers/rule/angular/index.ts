import { join } from "node:path";

import { readIfReadable } from "@/lib/fs";
import { isObject, parseJsonOrUndefined } from "@/lib/json";
import { sdkVersionForCli } from "@/lib/public-cli";
import { FileWriter } from "@/lib/orca/patchers/rule/file-writer";
import type { FileOp } from "@/lib/orca/patchers/rule/file-writer/types";
import type {
  ConfigWiringStatus,
  EjectActions,
  PatchContext,
  PatchExecOptions,
  PatchResult,
  PatchView,
} from "@/lib/orca/patchers/types";
import { AbstractRulePatcher } from "@/lib/orca/patchers/rule/base";
import {
  angularEntry,
  assertMountsRootComponent,
  type RootMount,
} from "@/lib/orca/patchers/rule/root-component";
import { angularProxyEdit } from "./angular-json";
import { angularRoutesEdit } from "./angular-routes";
import {
  appComponentTemplate,
  appTemplateHtml,
  devScriptEdit,
  LAUNCHER_PATH,
  launcherScriptsEdit,
  launcherTemplate,
  PROJECT_ID_MODULE_GITIGNORE,
  PROJECT_ID_MODULE_PATH,
  projectIdModuleEdit,
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
 * What setup does after the plan, and a repair, which replays the plan, never
 * does: it writes the module once (the launcher keeps it current, and an app
 * an earlier CLI set up never imports it), has git ignore it, and runs the
 * app's own scripts through the launcher, whose project id such an app
 * neither has nor needs: it builds without `.env.local`, which the launcher
 * would refuse.
 */
function setupOnlyOps(ctx: PatchContext): FileOp[] {
  return [
    { kind: "edit", path: PROJECT_ID_MODULE_PATH, edit: projectIdModuleEdit(ctx.project.id) },
    { kind: "append-gitignore", rules: [PROJECT_ID_MODULE_GITIGNORE] },
    // Golden-path `npm run dev`, through the launcher.
    { kind: "edit", path: "package.json", edit: devScriptEdit },
    { kind: "edit", path: "package.json", edit: launcherScriptsEdit },
  ];
}

/** Whether a script of `source`, a `package.json`, runs the launcher: setup moved this app's scripts. */
function runsLauncher(source: string | undefined): boolean {
  const pkg = source === undefined ? undefined : parseJsonOrUndefined(source);
  const scripts = isObject(pkg) && isObject(pkg.scripts) ? Object.values(pkg.scripts) : [];
  return scripts.some((command) => {
    return typeof command === "string" && command.startsWith(`node ${LAUNCHER_PATH}`);
  });
}

/** `a` and `b`, two runs of the file-writer over one app, as one result, each path once. */
function bothRuns(a: PatchResult, b: PatchResult): PatchResult {
  const unique = (paths: ReadonlyArray<string>) => {
    return [...new Set(paths)];
  };
  const written = unique([...a.filesWritten, ...b.filesWritten]);
  return {
    dryRun: a.dryRun,
    files: [...a.files, ...b.files].filter((file, index, all) => {
      return (
        all.findIndex((other) => {
          return other.path === file.path;
        }) === index
      );
    }),
    filesWritten: written,
    filesSkipped: unique([...a.filesSkipped, ...b.filesSkipped]).filter((path) => {
      return !written.includes(path);
    }),
    depsAdded: unique([...a.depsAdded, ...b.depsAdded]),
  };
}

/**
 * Rule-based patcher for an Angular app. Inherits the shared `.zitadel/` base
 * files from {@link AbstractRulePatcher} and contributes the managed root
 * component (`app.ts`/`app.html`) that renders the `@zitadel/sdk-angular`
 * widgets, a `proxy.conf.cjs` dev proxy (attaching the project secret from
 * `ZITADEL_PROJECT_SECRET` only to `POST /sessions/exchange`) wired into `angular.json`,
 * the `zitadel-ng.cjs` launcher, which writes the project id `app.ts` imports
 * into a git-ignored module before it runs `ng`, and the SDK dep.
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

  /** Applies the plan, then what only setup does ({@link setupOnlyOps}). */
  override async patch(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    const planned = await super.patch(ctx, opts);
    const setupOnly = await new FileWriter(opts).scaffold({ ops: setupOnlyOps(ctx), summary: [] });
    return bothRuns(planned, setupOnly);
  }

  /**
   * Restores what is missing, as the base repair does, except `app.ts`, which
   * imports the module the launcher writes, and the launcher, in an app whose
   * scripts do not run it: one an earlier CLI set up, whose `app.ts` names its
   * project. A missing `app.ts` there stays missing, and the doctor reports it.
   */
  override async repair(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    // An app whose scripts run `ng` gets neither file (see `verify`).
    return runsLauncher(await readIfReadable(join(opts.cwd, "package.json")))
      ? super.repair(ctx, opts)
      : super.repair(ctx, {
          ...opts,
          excludePaths: [...(opts.excludePaths ?? []), ROOT.path, LAUNCHER_PATH],
        });
  }
  /**
   * The base wirings, and, in an app whose scripts run `ng` (set up by an
   * earlier CLI) and whose `app.ts` is missing, why the repair leaves it
   * missing and what to do instead.
   */
  override async verify(
    ctx: PatchContext,
    opts: { cwd: string },
  ): Promise<ReadonlyArray<ConfigWiringStatus>> {
    const statuses = await super.verify(ctx, opts);
    const missing =
      (await readIfReadable(join(opts.cwd, ROOT.path))) === undefined &&
      !runsLauncher(await readIfReadable(join(opts.cwd, "package.json")));
    return missing
      ? [
          ...statuses,
          {
            path: ROOT.path,
            wiring: "convenience",
            state: "unknown",
            reason: `doctor --fix writes it only into an app whose serve, build and test scripts run ${LAUNCHER_PATH}: restore it from version control, or run those scripts as "node ${LAUNCHER_PATH} …" and run doctor --fix again`,
          },
        ]
      : statuses;
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
      { kind: "write", path: "src/app/app.html", contents: appTemplateHtml(ctx) },
      { kind: "write", path: LAUNCHER_PATH, contents: launcherTemplate() },
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
    // secret), and the launcher writes the project id the client imports; the
    // root component pair is the user's customization surface.
    return ["proxy.conf.cjs", LAUNCHER_PATH];
  }

  protected override conditionallyScaffoldedFiles(_view: PatchView): ReadonlyArray<string> {
    // An app an earlier CLI set up has no launcher, and a repair adds none, so
    // only a scaffold manifest that recorded one tracks it.
    return [LAUNCHER_PATH];
  }

  /** The base artifacts, and the module the launcher writes, which `eject` removes whole. */
  override artifacts(view: PatchView): EjectActions {
    const actions = super.artifacts(view);
    return { ...actions, rootConfigFiles: [...actions.rootConfigFiles, PROJECT_ID_MODULE_PATH] };
  }

  protected routeDeps(_view: PatchView): ReadonlyArray<string> {
    return [SDK_DEPENDENCY];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    // These files are touched via `edit` ops eject can't auto-revert: the proxy
    // wired into angular.json, auth paths added to app.routes.ts, and the
    // package.json scripts setup runs through zitadel-ng.cjs or added (`dev`).
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
