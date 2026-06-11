import { stableStringify } from "../../../json";
import { DEFAULT_SERVER } from "../../../server";
import { scaffold } from "./file-writer";
import type { FileOp, ScaffoldPlan } from "./file-writer/types";
import type {
  EjectActions,
  Patcher,
  PatchContext,
  PatchExecOptions,
  PatchResult,
  PatchView,
} from "../types";
import { reclaimableOps } from "./reclaim";

/**
 * Base for rule-based (deterministic, template-driven) patchers, as opposed to
 * a future LLM-driven family. It applies the integration by building a
 * file-operation plan and running the file-writer — that strategy stays
 * entirely inside this family, so callers only ever see the family-neutral
 * {@link Patcher} surface. Owns the framework-agnostic `.zitadel/` base files
 * and the shared eject classification; subclasses contribute only their
 * framework-specific routes/middleware.
 */
export abstract class AbstractRulePatcher implements Patcher {
  abstract canPatch(framework: string): boolean;

  /** Apply the full plan (base `.zitadel/` files + framework routes). */
  async patch(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    return scaffold(this.plan(ctx), opts);
  }

  /**
   * Re-apply only the reclaimable subset — env files, gitignore, the SDK
   * dependency, and marker-bearing routes — leaving the user-editable
   * `.zitadel/` resources untouched. Backs `doctor --fix`.
   */
  async repair(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    const plan = this.plan(ctx);
    return scaffold({ ops: reclaimableOps(plan), summary: plan.summary }, opts);
  }

  /** Shared base artifacts plus the subclass's marker-bearing route files. */
  artifacts(view: PatchView): EjectActions {
    return {
      markedFiles: this.routeFiles(view),
      rootConfigFiles: ["zitadel.json"],
      directories: [".zitadel"],
      envBackups: [".env.local"],
      dependencies: this.routeDeps(view),
    };
  }

  /**
   * The full file-operation plan this patcher would apply. Public so rule-family
   * unit tests can assert the planned ops directly; the generic {@link Patcher}
   * interface deliberately does not expose it (an LLM patcher has no such plan).
   */
  plan(ctx: PatchContext): ScaffoldPlan {
    return {
      ops: [...this.baseOps(ctx), ...this.routeOps(ctx)],
      summary: [this.summary(ctx)],
    };
  }

  /**
   * The framework-agnostic `.zitadel/` base files every rule patcher writes:
   * the project secret, `zitadel.json`, env templates, and an empty sync
   * state. The `schemas/` and `flows/` directories are created empty — the
   * server provisions the default user schema and flow definition when the
   * project is created, so nothing is scaffolded into them here. Pure: no
   * filesystem or network.
   */
  private baseOps(ctx: PatchContext): ReadonlyArray<FileOp> {
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
        kind: "merge-env",
        path: ".env.example",
        entries: {
          ZITADEL_PROJECT_ID: "",
          ZITADEL_ENVIRONMENT: "",
          ZITADEL_ISSUER: "",
          ZITADEL_URL: "",
        },
      },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: {
          ZITADEL_PROJECT_ID: ctx.project.id,
          ZITADEL_ENVIRONMENT: "development",
          ZITADEL_ISSUER: ctx.issuer,
          ZITADEL_URL: ctx.server,
        },
      },
      {
        kind: "write",
        path: ".zitadel/state.json",
        contents: `${stableStringify({ framework: ctx.framework.id, resources: {} })}\n`,
      },
    ];
  }

  /** Framework-specific route/middleware write ops plus the SDK dependency. */
  protected abstract routeOps(ctx: PatchContext): ReadonlyArray<FileOp>;
  /** Framework-specific managed (marker-bearing) file paths, for ejection. */
  protected abstract routeFiles(view: PatchView): ReadonlyArray<string>;
  /**
   * The package-manager dependencies the integration added, surfaced in
   * `eject`'s `next_commands` so the user can uninstall them themselves.
   */
  protected abstract routeDeps(view: PatchView): ReadonlyArray<string>;
  /** One-line summary of what the integration scaffolded. */
  protected abstract summary(ctx: PatchContext): { title: string; detail: string };
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
