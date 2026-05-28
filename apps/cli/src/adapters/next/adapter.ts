import { join } from "node:path";

import { MANAGED_MARKER } from "../../lib/paths";
import type { ScaffoldPlan } from "../../scaffolder/plan";
import type { FrameworkAdapter, ProjectContext } from "../index";

/**
 * Next.js `middleware.ts` at the project root. Wires `nextgenMiddleware` from
 * `@zitadel-nextgen/sdk-next` so the scaffolded `<zitadel-login api-base="/__nextgen">`
 * requests get same-origin-proxied to `NEXTGEN_ISSUER_URL` (the auth backend)
 * and `/profile` is JWT-gated.
 *
 * Filename + function name are the `middleware` form, not the Next 16 `proxy`
 * rename. Next 15 only recognises `middleware.ts` + `function middleware()`;
 * Next 16 accepts both (proxy is canonical, middleware is deprecated-but-working).
 * The middleware form therefore works on every supported Next major. Next 16
 * emits a one-time deprecation warning at boot — acceptable tradeoff for
 * single-template universal compatibility.
 *
 * Carries the managed-file marker so `doctor --fix` re-applies it.
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
 * {@link FrameworkAdapter} for the Next.js App Router. Builds scaffold plans
 * that place renderer-provided page templates under the detected `appDir`
 * and writes `middleware.ts`/`custom-elements.d.ts` at the project root.
 * `planSetup` composes the granular `planAdd*` plans so a full setup and an
 * incremental `doctor --fix` share one implementation.
 */
export class NextAdapter implements FrameworkAdapter {
  readonly id = "next" as const;
  readonly displayName = "Next.js App Router";

  async planSetup(ctx: ProjectContext): Promise<ScaffoldPlan> {
    const ops = [
      ...(await this.planAddLogin(ctx)).ops,
      ...(await this.planAddRegister(ctx)).ops,
      ...(await this.planAddProfile(ctx)).ops,
      ...(await this.planAddMiddleware(ctx)).ops,
    ];
    const provider = ctx.renderer.templates.provider;
    if (provider) {
      ops.push({
        kind: "write",
        path: join(ctx.framework.appDir, provider.filename),
        contents: provider.contents,
      });
    }
    // JSX type declarations for the `<zitadel-login>` / `<zitadel-logout>`
    // custom elements. Required so TypeScript doesn't complain about the
    // unknown JSX tags in the scaffolded pages.
    const customElementsDts = ctx.renderer.templates.customElementsDts?.();
    if (customElementsDts) {
      ops.push({
        kind: "write",
        path: join(ctx.framework.appDir, "../custom-elements.d.ts"),
        contents: customElementsDts.contents,
      });
    }
    const dep = this.sdkDependency(ctx);
    ops.push({ kind: "add-dep", name: dep.name, version: dep.version });
    return {
      ops,
      summary: [
        {
          title: "Next.js runtime",
          detail: `Scaffolded login/register/profile routes with renderer "${ctx.renderer.id}".`,
        },
      ],
    };
  }

  async planAddLogin(ctx: ProjectContext): Promise<ScaffoldPlan> {
    const page = ctx.renderer.templates.authPage("login");
    return {
      ops: [
        {
          kind: "write",
          path: join(ctx.framework.appDir, "login/page.tsx"),
          contents: page.contents,
        },
      ],
      summary: [
        { title: "Login route", detail: `Created ${ctx.framework.appDir}/login/page.tsx.` },
      ],
    };
  }

  async planAddRegister(ctx: ProjectContext): Promise<ScaffoldPlan> {
    const page = ctx.renderer.templates.authPage("register");
    return {
      ops: [
        {
          kind: "write",
          path: join(ctx.framework.appDir, "register/page.tsx"),
          contents: page.contents,
        },
      ],
      summary: [
        { title: "Register route", detail: `Created ${ctx.framework.appDir}/register/page.tsx.` },
      ],
    };
  }

  async planAddProfile(ctx: ProjectContext): Promise<ScaffoldPlan> {
    const page = ctx.renderer.templates.profilePage?.();
    if (!page) {
      return { ops: [], summary: [] };
    }
    return {
      ops: [
        {
          kind: "write",
          path: join(ctx.framework.appDir, "profile/page.tsx"),
          contents: page.contents,
        },
      ],
      summary: [
        { title: "Profile route", detail: `Created ${ctx.framework.appDir}/profile/page.tsx.` },
      ],
    };
  }

  async planAddMiddleware(ctx: ProjectContext): Promise<ScaffoldPlan> {
    return {
      ops: [
        {
          kind: "write",
          // `..` lifts out of app/ so middleware.ts lands at the project root,
          // the location Next.js expects for the file convention. Mirrors how
          // custom-elements.d.ts is written alongside this.
          path: join(ctx.framework.appDir, "../middleware.ts"),
          contents: middlewareTemplate,
        },
      ],
      summary: [
        {
          title: "Auth middleware",
          detail:
            "Created middleware.ts to forward /__nextgen/* to the backend and gate /profile.",
        },
      ],
    };
  }

  sdkDependency(ctx: ProjectContext): { name: string; version: string } {
    return ctx.renderer.dependency;
  }
}
