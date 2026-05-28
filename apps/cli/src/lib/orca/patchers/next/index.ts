import { join } from "node:path";

import { buildFlow } from "../../../flows";
import { stableStringify } from "../../../json";
import { MANAGED_MARKER } from "../../../paths";
import { DEFAULT_SERVER } from "../../../../platform/resolve-server";
import type { FileOp, ScaffoldPlan } from "../../file-writer/plan";
import type { EjectActions, Patcher, PatchContext, PatchView } from "../types";
import { getRenderer } from "./renderers/registry";
import type { RendererSpec } from "./renderers/types";

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
 * Integrates Zitadel into a Next.js App Router project. `plan` composes the
 * shared `.zitadel/` base files (built from {@link buildFlow} and the supplied
 * user schema) with the framework routes/middleware whose templates come from
 * the chosen renderer. Pure: no filesystem or network access.
 */
export class NextPatcher implements Patcher {
  /** Returns true for Next.js projects. */
  canPatch(framework: string): boolean {
    return framework === "next";
  }

  /** PURE: the full integration plan (base `.zitadel/` files + Next routes). */
  plan(ctx: PatchContext): ScaffoldPlan {
    const renderer = getRenderer(ctx.rendererId);
    return {
      ops: [...baseOps(ctx), ...nextCodeOps(ctx, renderer)],
      summary: [
        {
          title: "Next.js integration",
          detail: `Scaffolded login/register/profile routes with renderer "${ctx.rendererId}".`,
        },
      ],
    };
  }

  /** PURE: the files/dirs this integration owns, for marker-aware ejection. */
  artifacts(view: PatchView): EjectActions {
    const renderer = getRenderer(view.rendererId);
    return {
      markedFiles: nextCodeFilePaths(view.framework.appDir, renderer),
      rootConfigFiles: ["zitadel.json"],
      directories: [".zitadel"],
      envBackups: [".env.local"],
    };
  }
}

/**
 * Ordered paths of the framework code files this patcher writes. All carry the
 * managed marker. Shared by {@link NextPatcher.plan} (which adds contents) and
 * {@link NextPatcher.artifacts} (which only needs the paths) so the two cannot
 * drift.
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

/**
 * The framework-agnostic `.zitadel/` base files: secret, project config, user
 * schema, flow definition, env templates, and sync state. Flow content comes
 * from {@link buildFlow}; the schema is the caller's already-built object.
 */
function baseOps(ctx: PatchContext): FileOp[] {
  return [
    { kind: "mkdir", path: ".zitadel", mode: 0o700 },
    { kind: "mkdir", path: ".zitadel/flows" },
    { kind: "mkdir", path: ".zitadel/schemas" },
    { kind: "append-gitignore", entries: [".zitadel/secret", ".env*", "!.env.example"] },
    {
      kind: "write",
      path: ".zitadel/secret",
      mode: 0o600,
      contents: `${stableStringify({
        project_id: ctx.project.id,
        project_secret: ctx.project.projectSecret,
        preview_secret: ctx.project.previewSecret,
        preview_origins: ctx.project.previewOrigins,
        created_at: ctx.project.createdAt,
      })}\n`,
    },
    { kind: "write", path: "zitadel.json", contents: `${stableStringify(projectConfig(ctx))}\n` },
    {
      kind: "write",
      path: ".zitadel/schemas/user.json",
      contents: `${stableStringify(ctx.userSchema)}\n`,
    },
    {
      kind: "write",
      path: ".zitadel/flows/default.json",
      contents: `${stableStringify(buildFlow(ctx.authMethod, ctx.userFields))}\n`,
    },
    {
      kind: "merge-env",
      path: ".env.example",
      entries: {
        ZITADEL_PROJECT_ID: "",
        ZITADEL_ENVIRONMENT: "",
        ZITADEL_ISSUER: "",
        NEXTGEN_ISSUER_URL: "",
        NEXT_PUBLIC_ZITADEL_PROJECT_ID: "",
      },
    },
    {
      kind: "merge-env",
      path: ".env.local",
      entries: {
        ZITADEL_PROJECT_ID: ctx.project.id,
        ZITADEL_ENVIRONMENT: "development",
        ZITADEL_ISSUER: ctx.issuer,
        NEXTGEN_ISSUER_URL: ctx.server,
        NEXT_PUBLIC_ZITADEL_PROJECT_ID: ctx.project.id,
      },
    },
    {
      kind: "write",
      path: ".zitadel/state.json",
      contents: `${stableStringify({ framework: ctx.framework.id, resources: {} })}\n`,
    },
  ];
}

/** Builds the `zitadel.json` body persisted at the project root. */
function projectConfig(ctx: PatchContext): Record<string, unknown> {
  const environments: Record<string, unknown> = { development: { issuer: ctx.issuer } };
  if (ctx.project.previewOrigins.length > 0) {
    environments.preview = {
      issuer_pattern: ctx.project.previewOrigins.map((origin) => `https://${origin}`),
    };
  }
  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: ctx.project.id,
    server: resolveServerOrigin(ctx.server),
    framework: { id: ctx.framework.id },
    branding: { renderer: ctx.rendererId, attribution: "visible" },
    environments,
  };
}

/** Normalizes a server URL to its origin, falling back to {@link DEFAULT_SERVER}. */
function resolveServerOrigin(source: string): string {
  try {
    return new URL(source).origin;
  } catch {
    return DEFAULT_SERVER;
  }
}
