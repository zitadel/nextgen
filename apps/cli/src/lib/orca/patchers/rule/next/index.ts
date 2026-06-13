import { join } from "node:path";

import { MANAGED_MARKER } from "../../../../paths";
import type { FileOp } from "../file-writer/types";
import type { PatchContext, PatchView } from "../../types";
import { AbstractRulePatcher } from "../base";
import { getRenderer } from "./renderers/registry";
import type { RendererSpec } from "./renderers/types";

/**
 * Next.js request-boundary file at the project root. Wires `nextgenMiddleware` so the
 * generated project config's `/__nextgen` proxy path is same-origin proxied
 * to `ZITADEL_URL` and `/profile` is gated. Next 16 renamed this convention to
 * `proxy.ts`; older projects keep `middleware.ts`.
 * Carries the managed marker so `doctor --fix` reclaims it and `eject` removes it.
 */
function requestBoundaryTemplate(functionName: "middleware" | "proxy"): string {
  return `${MANAGED_MARKER}
import { nextgenMiddleware } from "@zitadel/sdk-next/middleware";
import type { NextRequest } from "next/server";

export function ${functionName}(req: NextRequest) {
  return nextgenMiddleware(req, {
    url: process.env.ZITADEL_URL,
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/profile/:path*"],
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

  protected routeOps(ctx: PatchContext): FileOp[] {
    return nextCodeOps(ctx, getRenderer(ctx.rendererId));
  }

  protected routeFiles(view: PatchView): ReadonlyArray<string> {
    return nextCodeFilePaths(view.framework, getRenderer(view.rendererId));
  }

  protected routeDeps(view: PatchView): ReadonlyArray<string> {
    return [getRenderer(view.rendererId).dependency.name];
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
  const paths = [join(appDir, "login/page.tsx"), join(appDir, "register/page.tsx")];
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

/** The Next route/request-boundary write ops plus the SDK dependency. */
function nextCodeOps(ctx: PatchContext, renderer: RendererSpec): FileOp[] {
  const appDir = ctx.framework.appDir;
  const ops: FileOp[] = [
    {
      kind: "write",
      path: join(appDir, "login/page.tsx"),
      contents: renderer.templates.authPage("login").contents,
    },
    {
      kind: "write",
      path: join(appDir, "register/page.tsx"),
      contents: renderer.templates.authPage("register").contents,
    },
  ];
  const profile = renderer.templates.profilePage?.();
  if (profile) {
    ops.push({ kind: "write", path: join(appDir, "profile/page.tsx"), contents: profile.contents });
  }
  const boundary = requestBoundaryFile(ctx.framework);
  ops.push({
    kind: "write",
    path: join(appDir, `../${boundary.filename}`),
    contents: requestBoundaryTemplate(boundary.functionName),
  });
  const provider = renderer.templates.provider;
  if (provider) {
    ops.push({ kind: "write", path: join(appDir, provider.filename), contents: provider.contents });
  }
  const dts = renderer.templates.customElementsDts?.();
  if (dts) {
    ops.push({
      kind: "write",
      path: join(appDir, "../custom-elements.d.ts"),
      contents: dts.contents,
    });
  }
  ops.push({
    kind: "add-dep",
    name: renderer.dependency.name,
    version: dependencyVersionForCli(ctx.cliVersion, renderer.dependency.version),
  });
  return ops;
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

function dependencyVersionForCli(cliVersion: string, fallback: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  if (/^\d+\.\d+\.\d+-alpha\.\d+$/.test(normalized)) {
    return normalized;
  }
  const prerelease = normalized.match(/^\d+\.\d+\.\d+-([0-9A-Za-z]+)(?:[.-]|$)/)?.[1];
  return prerelease ?? fallback;
}
