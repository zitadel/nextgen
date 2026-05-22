import { join } from "node:path";

import type { ScaffoldPlan } from "../../scaffolder/plan";
import type { FrameworkAdapter, ProjectContext } from "../index";

export class NextAdapter implements FrameworkAdapter {
  readonly id = "next" as const;
  readonly displayName = "Next.js App Router";

  async planSetup(ctx: ProjectContext): Promise<ScaffoldPlan> {
    const ops = [
      ...(await this.planAddLogin(ctx)).ops,
      ...(await this.planAddRegister(ctx)).ops,
      ...(await this.planAddProfile(ctx)).ops,
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
    if (!page) return { ops: [], summary: [] };
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

  sdkDependency(ctx: ProjectContext): { name: string; version: string } {
    return ctx.renderer.dependency;
  }

  envKeys(): string[] {
    return [
      "ZITADEL_PROJECT_ID",
      "ZITADEL_ENVIRONMENT",
      "ZITADEL_ISSUER",
      "NEXT_PUBLIC_ZITADEL_API_BASE",
      "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
    ];
  }
}
