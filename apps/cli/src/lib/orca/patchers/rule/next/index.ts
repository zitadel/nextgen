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
        }
      : undefined,
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
import Link from "next/link";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", colorScheme: "dark", background: "#0f0f11", color: "#f4f4f6", padding: "48px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: "560px" }}>
        <p style={{ margin: "0 0 12px", color: "#bfbfcf", fontSize: "14px" }}>Zitadel auth</p>
        <h1 style={{ margin: "0 0 24px", fontSize: "32px", lineHeight: 1.15, color: "#f4f4f6" }}>Sign in, create an account, or open your profile.</h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          <Link href="/login" style={{ padding: "10px 16px", borderRadius: "8px", background: "#f4f4f6", color: "#0f0f11", textDecoration: "none", fontWeight: 600 }}>
            Sign in
          </Link>
          <Link href="/register" style={{ padding: "10px 16px", borderRadius: "8px", background: "#252528", color: "#f4f4f6", textDecoration: "none", fontWeight: 600 }}>
            Create account
          </Link>
          <Link href="/profile" style={{ padding: "10px 16px", borderRadius: "8px", border: "1px solid #252528", color: "#f4f4f6", textDecoration: "none", fontWeight: 600 }}>
            Profile
          </Link>
        </div>
      </section>
    </main>
  );
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
