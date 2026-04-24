import { join } from "node:path";

import type { FrameworkAdapter, ProjectContext } from "../index";
import type { ScaffoldPlan } from "../../scaffolder/plan";
import { MANAGED_MARKER } from "../../lib/paths";

export class NextAdapter implements FrameworkAdapter {
  readonly id = "next" as const;
  readonly displayName = "Next.js App Router";

  async planSetup(ctx: ProjectContext): Promise<ScaffoldPlan> {
    return mergePlans(await this.planAddLogin(ctx), await this.planAddRegister(ctx), {
      ops: [
        {
          kind: "write",
          path: join(ctx.framework.appDir, "zitadel-provider.tsx"),
          contents: providerTemplate(),
        },
        { kind: "add-dep", name: this.sdkDependency().name, version: this.sdkDependency().version },
      ],
      summary: [{ title: "Next.js runtime", detail: "Added Zitadel auth pages and provider helper." }],
    });
  }

  async planAddLogin(ctx: ProjectContext): Promise<ScaffoldPlan> {
    return {
      ops: [
        {
          kind: "write",
          path: join(ctx.framework.appDir, "login/page.tsx"),
          contents: authPageTemplate("login"),
        },
      ],
      summary: [{ title: "Login route", detail: `Created ${ctx.framework.appDir}/login/page.tsx.` }],
    };
  }

  async planAddRegister(ctx: ProjectContext): Promise<ScaffoldPlan> {
    return {
      ops: [
        {
          kind: "write",
          path: join(ctx.framework.appDir, "register/page.tsx"),
          contents: authPageTemplate("register"),
        },
      ],
      summary: [{ title: "Register route", detail: `Created ${ctx.framework.appDir}/register/page.tsx.` }],
    };
  }

  sdkDependency(): { name: string; version: string } {
    return { name: "@zitadel/sdk-next", version: "latest" };
  }

  envKeys(): string[] {
    return ["ZITADEL_PROJECT_ID", "ZITADEL_ENVIRONMENT", "ZITADEL_PROJECT_SECRET", "ZITADEL_ISSUER"];
  }
}

function mergePlans(...plans: ScaffoldPlan[]): ScaffoldPlan {
  return {
    ops: plans.flatMap((plan) => plan.ops),
    summary: plans.flatMap((plan) => plan.summary),
  };
}

function authPageTemplate(mode: "login" | "register"): string {
  const title = mode === "login" ? "Sign in" : "Create account";
  return `${MANAGED_MARKER}
import { ZitadelAuth } from "@zitadel/sdk-next";

export default function ${mode === "login" ? "LoginPage" : "RegisterPage"}() {
  return <ZitadelAuth mode="${mode}" title="${title}" />;
}
`;
}

function providerTemplate(): string {
  return `${MANAGED_MARKER}
"use client";

import { ZitadelProvider } from "@zitadel/sdk-next";
import type { ReactNode } from "react";

export function ZitadelAppProvider({ children }: { children: ReactNode }) {
  return <ZitadelProvider>{children}</ZitadelProvider>;
}
`;
}
