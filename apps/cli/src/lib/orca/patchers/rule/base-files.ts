import { buildFlow } from "../../../flows";
import { stableStringify } from "../../../json";
import { DEFAULT_SERVER } from "../../../api/resolve-server";
import type { FileOp } from "./file-writer/plan";
import type { PatchContext } from "../types";

/**
 * The framework-agnostic `.zitadel/` base files every patcher writes,
 * regardless of family (rule-based or, later, LLM-driven): the project secret,
 * `zitadel.json`, user schema, flow definition, env templates, and sync state.
 * Flow content comes from {@link buildFlow}; the schema is the caller's
 * already-built object. Pure: no filesystem or network.
 *
 * Kept separate from any patcher base class so a future LLM patcher can reuse
 * it verbatim instead of re-implementing the base tree.
 */
export function zitadelBaseOps(ctx: PatchContext): FileOp[] {
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
