import { buildFlow } from "../../../flows";
import { stableStringify } from "../../../json";
import { DEFAULT_SERVER } from "../../../server";
import { scaffold } from "./file-writer";
import type { FileOp, ScaffoldPlan } from "./file-writer/types";
import type {
  EjectActions,
  NarrationRow,
  NarrationSentence,
  Patcher,
  PatcherNarration,
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

  /**
   * Cross-framework narration for the `.zitadel/` base files plus the
   * `package.json` and `.env.local` rows that bookend the INSTALLED
   * section. Subclasses contribute their framework-specific rows and
   * sentences via {@link frameworkInstalledRows} and
   * {@link frameworkSentences}; the result is the merged narration the
   * setup command consumes.
   */
  narration(view: PatchView): PatcherNarration {
    return {
      sdkPackage: this.sdkPackageFor(view),
      installedRows: [
        // "Package" is always the first row — the SDK the patcher adds
        // to `package.json`. The label is constant; the value rendered
        // by the setup command uses `sdkPackage`, with the manifest
        // file (typically `package.json`) shown as the secondary detail.
        { label: "Package", path: "package.json", secondary: "package.json" },
        ...this.frameworkInstalledRows(view),
        // ".env.local" closes the section. Both the file and the row
        // are common across every rule-based framework patcher.
        { label: "Env vars", path: ".env.local" },
      ],
      sentences: [...BASE_SENTENCES, ...this.frameworkSentences(view)],
      // The `mkdir` ops for `.zitadel` and its sub-directories surface
      // in `filesWritten` alongside actual file writes. They're noise at
      // the per-step layer (the files inside narrate on their own
      // lines), so the narrator skips them.
      silent: [".zitadel", ".zitadel/flows", ".zitadel/schemas"],
    };
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
   * the project secret, `zitadel.json`, user schema, flow definition, env
   * templates, and sync state. Flow content comes from {@link buildFlow}; the
   * schema is the caller's already-built object. Pure: no filesystem or network.
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
        kind: "write",
        path: ".zitadel/schemas/user.json",
        contents: `${stableStringify(ctx.userSchema)}\n`,
      },
      {
        kind: "write",
        path: ".zitadel/flows/default.json",
        contents: `${stableStringify(buildFlow(ctx.userFields))}\n`,
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
  /**
   * The SDK package name shown in the INSTALLED "Package" row. Typically
   * the same name returned from {@link routeDeps} but exposed separately
   * because the row carries a label distinct from the dep, and the value
   * may be a friendlier alias (e.g. `@zitadel-nextgen/sdk-next`).
   */
  protected abstract sdkPackageFor(view: PatchView): string;
  /**
   * Framework-specific rows appended to the INSTALLED section between
   * the common "Package" and "Env vars" rows the abstract base provides.
   * Display order is preserved as-is.
   */
  protected abstract frameworkInstalledRows(view: PatchView): ReadonlyArray<NarrationRow>;
  /**
   * Subject phrases for the framework-specific files this patcher writes,
   * used in the `"Wrote {subject} ({path})"` per-file narration. Paths
   * not listed here narrate as bare paths.
   */
  protected abstract frameworkSentences(view: PatchView): ReadonlyArray<NarrationSentence>;
}

/**
 * Narration sentences for the cross-framework `.zitadel/` base files plus
 * `package.json`. Lives on the abstract base because every rule-based
 * patcher writes exactly these files via {@link AbstractRulePatcher.baseOps};
 * a framework patcher contributing its own files adds them via
 * {@link AbstractRulePatcher.frameworkSentences}.
 */
const BASE_SENTENCES: ReadonlyArray<NarrationSentence> = [
  { path: ".gitignore", subject: "the project's .gitignore additions" },
  { path: ".zitadel/secret", subject: "the local project secret" },
  { path: "zitadel.json", subject: "the Zitadel project configuration" },
  { path: ".zitadel/schemas/user.json", subject: "the user schema definition" },
  { path: ".zitadel/flows/default.json", subject: "the default authentication flow" },
  { path: ".env.example", subject: "the .env example template" },
  { path: ".env.local", subject: "the local development environment variables" },
  { path: ".zitadel/state.json", subject: "the empty sync state file" },
  { path: "package.json", subject: "package.json with the SDK dependency" },
];

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
