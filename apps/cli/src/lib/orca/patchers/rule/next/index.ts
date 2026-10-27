import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { ZitadelError } from "../../../../errors";
import { MANAGED_MARKER } from "../../../../paths";
import { sdkVersionForCli } from "../../../../public-cli";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher, PREFLIGHT_FORCE_NOTE } from "../base";
import { devScriptPortOp } from "../dev-script-port";
import { PUBLIC_PROJECT_ID_VARIABLE } from "../public-project-id";
import { getRenderer } from "./renderers/registry";
import type { RendererSpec } from "./renderers/types";

/**
 * Next.js request-boundary file at the project root. Wires `nextgenMiddleware` so the
 * generated project config's `/__nextgen` proxy path is same-origin proxied
 * to `ZITADEL_URL` and `/profile` is gated. Next 16 renamed this convention to
 * `proxy.ts`; older projects keep `middleware.ts`.
 * The matcher covers every route but Next's build files, so `protectedRoutes`
 * alone decides what needs a sign-in: with a matcher listing routes, a
 * protected route it misses never reaches the middleware and stays public.
 * Carries the managed marker so `doctor --fix` reclaims it and `eject` removes it.
 */
function requestBoundaryTemplate(functionName: "middleware" | "proxy"): string {
  return `${MANAGED_MARKER}
import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

export function ${functionName}(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL,
    // The routes that need a sign-in. To protect another, add it here; a
    // trailing * covers every path that starts with it, as in "/orders*".
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  });
}

export const config = {
  // Every route but Next.js's build files and favicon.ico, so the list above
  // alone decides what needs a sign-in, and auth() sees the session on every
  // page. A protected route that a narrower matcher leaves out stays public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
`;
}

/**
 * Rule-based patcher for the Next.js App Router. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * Next routes and request boundary whose templates come from the chosen renderer.
 */
export class NextPatcher extends AbstractRulePatcher {
  /** Returns true for Next.js projects. */
  canPatch(framework: string): boolean {
    return framework === "next";
  }

  /**
   * Next.js runs one request boundary, and it looks for it in two places and
   * under every page extension: `middleware.ts` beside the boundary setup
   * writes is as much a conflict as one at the same path, but the file-writer
   * only sees the latter. Next 16 refuses to start with both a `proxy.*` and a
   * `middleware.*` at the project root or in `src/` (its dev server checks
   * both levels), and a second file under the same name means one of them
   * silently never runs. On Next 15 a `proxy.ts` is just a file of the app's,
   * unless the version is unknown: then setup writes Next 15's
   * `middleware.ts`, and cannot rule out a Next 16 that rejects the pair.
   */
  protected override async preflight(ctx: PatchContext, cwd: string): Promise<void> {
    const boundary = requestBoundaryFile(ctx.framework);
    const target = join(ctx.framework.appDir, `../${boundary.filename}`);
    const unknownVersion = ctx.framework.versionMajor === undefined;
    const names =
      boundary.functionName === "proxy" || unknownVersion
        ? ["middleware", "proxy"]
        : ["middleware"];
    for (const dir of [".", "src"]) {
      for (const name of names) {
        for (const extension of BOUNDARY_EXTENSIONS) {
          const path = join(dir, `${name}.${extension}`);
          if (path !== target && (await isFile(join(cwd, path)))) {
            throw boundaryConflict(path, target, unknownVersion);
          }
        }
      }
    }
  }

  protected devPortOps(ctx: PatchContext): FileOp[] {
    return [devScriptPortOp(ctx.issuer)];
  }

  protected routeOps(ctx: PatchContext): FileOp[] {
    return nextCodeOps(ctx, getRenderer(ctx.rendererId));
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    return nextCodeFilePaths(view.framework, getRenderer(view.rendererId));
  }

  protected override infrastructureFiles(view: PatchView): ReadonlyArray<string> {
    return nextInfrastructureFilePaths(view.framework, getRenderer(view.rendererId));
  }

  protected override conditionallyScaffoldedFiles(view: PatchView): ReadonlyArray<string> {
    // Written only when setup created the app skeleton itself; on a
    // pre-existing app the homepage stays user-owned (see nextCodeOps).
    return [join(view.framework.appDir, "page.tsx")];
  }

  protected override retiredAlternateFiles(
    view: PatchView,
  ): Readonly<Record<string, ReadonlyArray<string>>> {
    // Next renamed the request boundary in v16 (middleware.ts → proxy.ts)
    // and throws at build time when both exist — but only in the ≥16
    // direction. On Next 15, proxy.ts was not a reserved convention, so a
    // root proxy.ts there is the user's own file, never a conflicting
    // boundary. Declaring the alternate one-way keeps a healthy Next 15 app
    // with an unrelated proxy.ts passing.
    const current = requestBoundaryFile(view.framework).filename;
    if (current !== "proxy.ts") {
      return {};
    }
    return {
      [join(view.framework.appDir, "../proxy.ts")]: [
        join(view.framework.appDir, "../middleware.ts"),
      ],
    };
  }

  protected routeDeps(view: PatchView): ReadonlyArray<string> {
    return [getRenderer(view.rendererId).dependency.name];
  }

  protected override routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    // The `dev` script gets the project's dev-server port pinned into it via
    // an `edit` op eject can't auto-revert, so it has to be surfaced as a
    // manual cleanup step like any other in-place config merge.
    return ["package.json"];
  }

  protected summary(ctx: PatchContext): { title: string; detail: string } {
    return {
      title: "Next.js integration",
      detail: `Scaffolded login/register/profile routes with renderer "${ctx.rendererId}".`,
    };
  }
}

/**
 * Ordered paths of the framework code files the patcher writes. All carry the
 * managed marker. Shared by {@link NextPatcher.routeOps} (which adds contents)
 * and {@link NextPatcher.routeFiles} (which only needs the paths) so the two
 * cannot drift.
 */
function nextCodeFilePaths(
  framework: PatchView["framework"],
  renderer: RendererSpec,
): ReadonlyArray<string> {
  const appDir = framework.appDir;
  const paths = [
    join(appDir, "page.tsx"),
    join(appDir, "login/page.tsx"),
    join(appDir, "register/page.tsx"),
  ];
  if (renderer.templates.profilePage) {
    paths.push(join(appDir, "profile/page.tsx"));
  }
  paths.push(join(appDir, `../${requestBoundaryFile(framework).filename}`));
  if (renderer.templates.provider) {
    paths.push(join(appDir, renderer.templates.provider.filename));
  }
  if (renderer.templates.customElementsDts) {
    paths.push(join(appDir, "../custom-elements.d.ts"));
  }
  return paths;
}

/**
 * The subset of {@link nextCodeFilePaths} that is load-bearing for the auth
 * integration rather than a presentation starting point: the request boundary
 * (proxy/middleware), the provider file, and the custom-elements declarations.
 * Shares path construction with {@link nextCodeFilePaths} so the two cannot
 * drift; the `doctor` managed-files check fails when one of these is missing.
 */
function nextInfrastructureFilePaths(
  framework: PatchView["framework"],
  renderer: RendererSpec,
): ReadonlyArray<string> {
  const appDir = framework.appDir;
  const paths = [join(appDir, `../${requestBoundaryFile(framework).filename}`)];
  if (renderer.templates.provider) {
    paths.push(join(appDir, renderer.templates.provider.filename));
  }
  if (renderer.templates.customElementsDts) {
    paths.push(join(appDir, "../custom-elements.d.ts"));
  }
  return paths;
}

/** The Next route/request-boundary write ops plus the SDK dependency. */
function nextCodeOps(ctx: PatchContext, renderer: RendererSpec): FileOp[] {
  const appDir = ctx.framework.appDir;
  const pageContext = { useCase: ctx.useCase, posture: ctx.posture };
  const profile = renderer.templates.profilePage?.(pageContext);
  const provider = renderer.templates.provider;
  const dts = renderer.templates.customElementsDts?.();
  const boundary = requestBoundaryFile(ctx.framework);
  return [
    ctx.scaffoldedFramework
      ? {
          kind: "edit",
          path: join(appDir, "page.tsx"),
          edit: () => homePageTemplate(),
          // Replaces create-next-app's default homepage wholesale; the
          // missing-only repair path must not replay it over user content.
          overwrites: true,
        }
      : undefined,
    {
      kind: "write",
      path: join(appDir, "login/page.tsx"),
      contents: renderer.templates.authPage("login", pageContext).contents,
    },
    {
      kind: "write",
      path: join(appDir, "register/page.tsx"),
      contents: renderer.templates.authPage("register", pageContext).contents,
    },
    profile
      ? { kind: "write", path: join(appDir, "profile/page.tsx"), contents: profile.contents }
      : undefined,
    {
      kind: "write",
      path: join(appDir, `../${boundary.filename}`),
      contents: requestBoundaryTemplate(boundary.functionName),
    },
    provider
      ? { kind: "write", path: join(appDir, provider.filename), contents: provider.contents }
      : undefined,
    dts
      ? { kind: "write", path: join(appDir, "../custom-elements.d.ts"), contents: dts.contents }
      : undefined,
    // Next.js exposes NEXT_PUBLIC_-prefixed vars to client code.
    { kind: "merge-env", path: ".env.example", entries: { [PUBLIC_PROJECT_ID_VARIABLE.next]: "" } },
    {
      kind: "merge-env",
      path: ".env.local",
      entries: { [PUBLIC_PROJECT_ID_VARIABLE.next]: ctx.project.id },
    },
    {
      kind: "add-dep",
      name: renderer.dependency.name,
      version: sdkVersionForCli(ctx.cliVersion),
    },
    // `next dev` takes its port from the command line only, so without this
    // the app can serve a port the project does not allow as an origin.
    devScriptPortOp(ctx.issuer),
  ].filter((op): op is FileOp => op !== undefined);
}

/**
 * The home page of an app setup scaffolded: a redirect to `/login`. The
 * pinned `create-next-app` turns on Cache Components, whose dev server
 * validates every page for instant navigation and logs the redirect it throws
 * as an error on each request to `/`; `instant = false` exempts the page.
 */
function homePageTemplate(): string {
  return `${MANAGED_MARKER}
import { redirect } from "next/navigation";

// A redirect is never an instant navigation: tell Next.js not to validate it.
export const instant = false;

export default function Home() {
  redirect("/login");
}
`;
}

function requestBoundaryFile(framework: PatchContext["framework"]): {
  filename: "middleware.ts" | "proxy.ts";
  functionName: "middleware" | "proxy";
} {
  if ((framework.versionMajor ?? 0) >= 16) {
    return { filename: "proxy.ts", functionName: "proxy" };
  }
  return { filename: "middleware.ts", functionName: "middleware" };
}

/** The extensions Next.js reads a request boundary under: its default `pageExtensions`. */
const BOUNDARY_EXTENSIONS = ["tsx", "ts", "jsx", "js"] as const;

/** Why the app's own request boundary at `existing` stops setup, which writes `target`. */
function boundaryConflict(existing: string, target: string, unknownVersion: boolean): ZitadelError {
  const existingName = basename(existing).split(".")[0];
  const targetName = basename(target, ".ts");
  const details = { path: existing, writes: target };
  if (existingName === targetName) {
    return new ZitadelError(
      "E_CONFLICT",
      `Next.js runs one ${targetName} file, and this app already has ${existing}`,
      {
        hint:
          `Setup writes ${target}, and one of the two would never run. Move ${existing} ` +
          `aside and rerun setup, then merge it into ${target}. ${PREFLIGHT_FORCE_NOTE}`,
        details,
      },
    );
  }
  // With no version, the existing proxy.ts may be Next 16's boundary or, on
  // Next 15, just a module of the app's: only the version decides, so pinning
  // it is the fix, not moving the file.
  const remedy = unknownVersion
    ? 'Setup reads no Next.js version from package.json (a tag such as "latest" names ' +
      `none), so it writes the ${target} of Next 15. Pin next to the version range the app ` +
      'runs, such as "^16.0.0", and rerun setup: on Next 16 it then writes proxy.ts, and on ' +
      `Next 15 it leaves your ${existing} alone.`
    : "Next.js 16 renamed middleware.ts to proxy.ts. Move " +
      `${existing} aside and rerun setup, then merge it into ${target}.`;
  return new ZitadelError(
    "E_CONFLICT",
    `Next.js 16 will not start with both ${existing} and the ${target} setup writes`,
    { hint: `${remedy} ${PREFLIGHT_FORCE_NOTE}`, details },
  );
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
