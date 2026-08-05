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
  const profile = renderer.templates.profilePage?.();
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
      contents: renderer.templates.authPage("login", { useCase: ctx.useCase }).contents,
    },
    {
      kind: "write",
      path: join(appDir, "register/page.tsx"),
      contents: renderer.templates.authPage("register", { useCase: ctx.useCase }).contents,
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
    { kind: "merge-env", path: ".env.example", entries: { NEXT_PUBLIC_ZITADEL_PROJECT_ID: "" } },
    {
      kind: "merge-env",
      path: ".env.local",
      entries: { NEXT_PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id },
    },
    {
      kind: "add-dep",
      name: renderer.dependency.name,
      version: dependencyVersionForCli(ctx.cliVersion, renderer.dependency.version),
    },
  ].filter((op): op is FileOp => op !== undefined);
}

function homePageTemplate(): string {
  return `${MANAGED_MARKER}
import { redirect } from "next/navigation";

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

function dependencyVersionForCli(cliVersion: string, fallback: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  if (/^\d+\.\d+\.\d+-alpha\.\d+$/.test(normalized)) {
    return normalized;
  }
  const prerelease = normalized.match(/^\d+\.\d+\.\d+-([0-9A-Za-z]+)(?:[.-]|$)/)?.[1];
  return prerelease ?? fallback;
}
