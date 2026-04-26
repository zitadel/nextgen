import { join } from "node:path";

import type { FrameworkAdapter, ProjectContext } from "../index";
import type { ScaffoldPlan } from "../../scaffolder/plan";

export class NextAdapter implements FrameworkAdapter {
  readonly id = "next" as const;
  readonly displayName = "Next.js App Router";

  async planSetup(ctx: ProjectContext): Promise<ScaffoldPlan> {
    const ops = [...(await this.planAddLogin(ctx)).ops, ...(await this.planAddRegister(ctx)).ops];
    const provider = ctx.renderer.templates.provider;
    if (provider) {
      ops.push({
        kind: "write",
        path: join(ctx.framework.appDir, provider.filename),
        contents: provider.contents,
      });
    }
    const dep = this.sdkDependency(ctx);
    ops.push({ kind: "add-dep", name: dep.name, version: dep.version });
    return {
      ops,
      summary: [
        {
          title: "Next.js runtime",
          detail: `Scaffolded login/register routes with renderer "${ctx.renderer.id}".`,
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
      summary: [{ title: "Login route", detail: `Created ${ctx.framework.appDir}/login/page.tsx.` }],
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
      summary: [{ title: "Register route", detail: `Created ${ctx.framework.appDir}/register/page.tsx.` }],
    };
  }

  sdkDependency(ctx: ProjectContext): { name: string; version: string } {
    return ctx.renderer.dependency;
  }

  envKeys(): string[] {
    return ["ZITADEL_PROJECT_ID", "ZITADEL_ENVIRONMENT", "ZITADEL_ISSUER"];
  }
}
