import { join } from "node:path";

import { MANAGED_MARKER } from "../../../../paths";
import type { FileOp } from "../file-writer/types";
import type {
  NarrationRow,
  NarrationSentence,
  PatchContext,
  PatchView,
} from "../../types";
import { AbstractRulePatcher } from "../base";
import { getRenderer } from "./renderers/registry";
import type { RendererSpec } from "./renderers/types";

/**
 * Fixed name shown in the INSTALLED "Package" row. The Next patcher
 * always adds the same SDK regardless of renderer; deviation from this
 * (e.g. a future Lit-only renderer with a different SDK) would override
 * {@link NextPatcher.sdkPackageFor}.
 */
const NEXT_SDK_PACKAGE = "@zitadel-nextgen/sdk-next";

/**
 * Next.js `middleware.ts` at the project root. Wires `nextgenMiddleware` so the
 * scaffolded `<zitadel-login api-base="/__nextgen">` requests are same-origin
 * proxied to `NEXTGEN_ISSUER_URL` and `/profile` is gated. The `middleware`
 * form (not the Next 16 `proxy` rename) works on every supported Next major.
 * Carries the managed marker so `doctor --fix` reclaims it and `eject` removes it.
 */
const middlewareTemplate = `${MANAGED_MARKER}
import { nextgenMiddleware } from "@zitadel-nextgen/sdk-next/middleware";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  return nextgenMiddleware(req, {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL,
    protectedRoutes: ["/profile"],
    loginPath: "/login",
  });
}

export const config = {
  matcher: ["/__nextgen/:path*", "/profile/:path*"],
};
`;

/**
 * Rule-based patcher for the Next.js App Router. Inherits the shared
 * `.zitadel/` base files from {@link AbstractRulePatcher} and contributes the
 * Next routes/middleware whose templates come from the chosen renderer.
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
    return nextCodeFilePaths(view.framework.appDir, getRenderer(view.rendererId));
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

  protected sdkPackageFor(_view: PatchView): string {
    return NEXT_SDK_PACKAGE;
  }

  /**
   * INSTALLED rows in display order: login, register, profile (when the
   * renderer ships one), then middleware. Each row's `path` is taken
   * straight from {@link nextCodeFilePaths} so the row only shows when
   * the file was actually written — opt-out renderers (no profile page)
   * silently drop their row.
   */
  protected frameworkInstalledRows(view: PatchView): ReadonlyArray<NarrationRow> {
    const appDir = view.framework.appDir;
    const renderer = getRenderer(view.rendererId);
    const rows: NarrationRow[] = [
      { label: "Login page", path: join(appDir, "login/page.tsx") },
      { label: "Register page", path: join(appDir, "register/page.tsx") },
    ];
    if (renderer.templates.profilePage) {
      rows.push({ label: "Profile page", path: join(appDir, "profile/page.tsx") });
    }
    rows.push({ label: "Middleware", path: join(appDir, "../middleware.ts") });
    return rows;
  }

  /**
   * Per-file narration subjects for the Next-specific managed files.
   * Mirrors the path list from {@link nextCodeFilePaths} so the two
   * cannot drift; paths returned by the abstract base (`.zitadel/*`,
   * `package.json`, `.env.local`) are narrated by `BASE_SENTENCES` and
   * deliberately omitted here.
   */
  protected frameworkSentences(view: PatchView): ReadonlyArray<NarrationSentence> {
    const appDir = view.framework.appDir;
    const renderer = getRenderer(view.rendererId);
    const sentences: NarrationSentence[] = [
      { path: join(appDir, "login/page.tsx"), subject: "the login page" },
      { path: join(appDir, "register/page.tsx"), subject: "the registration page" },
    ];
    if (renderer.templates.profilePage) {
      sentences.push({ path: join(appDir, "profile/page.tsx"), subject: "the profile page" });
    }
    sentences.push({ path: join(appDir, "../middleware.ts"), subject: "the Next.js middleware" });
    if (renderer.templates.customElementsDts) {
      sentences.push({
        path: join(appDir, "../custom-elements.d.ts"),
        subject: "the web-component type declarations",
      });
    }
    return sentences;
  }
}

/**
 * Ordered paths of the framework code files the patcher writes. All carry the
 * managed marker. Shared by {@link NextPatcher.routeOps} (which adds contents)
 * and {@link NextPatcher.routeFiles} (which only needs the paths) so the two
 * cannot drift.
 */
function nextCodeFilePaths(appDir: string, renderer: RendererSpec): ReadonlyArray<string> {
  const paths = [join(appDir, "login/page.tsx"), join(appDir, "register/page.tsx")];
  if (renderer.templates.profilePage) {
    paths.push(join(appDir, "profile/page.tsx"));
  }
  paths.push(join(appDir, "../middleware.ts"));
  if (renderer.templates.provider) {
    paths.push(join(appDir, renderer.templates.provider.filename));
  }
  if (renderer.templates.customElementsDts) {
    paths.push(join(appDir, "../custom-elements.d.ts"));
  }
  return paths;
}

/** The Next route/middleware write ops plus the SDK dependency. */
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
  ops.push({ kind: "write", path: join(appDir, "../middleware.ts"), contents: middlewareTemplate });
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
  ops.push({ kind: "add-dep", name: renderer.dependency.name, version: renderer.dependency.version });
  return ops;
}
