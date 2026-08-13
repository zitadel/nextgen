import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { metaSchemaFiles, META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";

import { stableStringify } from "../../../json";
import { normalizePublicCliJson } from "../../../public-cli";
import { DEFAULT_SERVER } from "../../../server";
import { scaffold } from "./file-writer";
import type { FileOp, ScaffoldPlan } from "./file-writer/types";
import {
  AGENTS_HEADER,
  agentsGuidanceSection,
  README_HEADER,
  readmeGuidanceSection,
  upsertGuidanceSection,
} from "./guidance";
import type {
  ConfigWiringStatus,
  EjectActions,
  Patcher,
  PatchContext,
  PatchExecOptions,
  PatchResult,
  PatchView,
} from "../types";
import { reclaimableOps, withoutExistingTargets } from "./reclaim";

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
   * `.zitadel/` resources untouched. Backs `doctor --fix`. With
   * `opts.missingOnly` the content ops are further narrowed to files that do
   * not exist (see {@link withoutExistingTargets}) and the writer runs without
   * `force`, so the repair restores deleted managed files and can never
   * overwrite an edited or user-adopted one.
   */
  async repair(ctx: PatchContext, opts: PatchExecOptions): Promise<PatchResult> {
    const plan = this.plan(ctx);
    let ops = opts.missingOnly
      ? await withoutExistingTargets(reclaimableOps(plan), opts.cwd)
      : reclaimableOps(plan);
    const excluded = new Set(opts.excludePaths ?? []);
    if (excluded.size > 0) {
      ops = ops.filter((op) => {
        if (op.kind === "write") {
          return !excluded.has(op.path);
        }
        if (op.kind === "edit" && op.overwrites) {
          const candidates = typeof op.path === "string" ? [op.path] : op.path;
          return !candidates.some((candidate) => excluded.has(candidate));
        }
        return true;
      });
    }
    const execOpts = opts.missingOnly ? { ...opts, force: false } : opts;
    return scaffold({ ops, summary: plan.summary }, execOpts);
  }

  /**
   * Probe whether the labelled config wirings are still applied, using each
   * merge transform's own idempotency: the transforms only add what is
   * missing and return the source unchanged when everything they manage is
   * present, so a changed output means the wiring is absent from the user's
   * config. Every labelled wiring gets a verdict: a missing host file is
   * `detached` (the wiring cannot be applied in a file that does not exist),
   * and a transform that throws on restructured content yields `unknown` —
   * surfaced rather than silently dropped, so a deleted `angular.json` can
   * never read as healthy. Read-only.
   */
  async verify(
    ctx: PatchContext,
    opts: { cwd: string },
  ): Promise<ReadonlyArray<ConfigWiringStatus>> {
    const statuses: ConfigWiringStatus[] = [];
    for (const op of this.plan(ctx).ops) {
      if (op.kind !== "edit" || !op.wiring) {
        continue;
      }
      const candidates = typeof op.path === "string" ? [op.path] : op.path;
      let path = candidates[0]!;
      let source: string | undefined;
      for (const candidate of candidates) {
        const contents = await readTextIfExists(join(opts.cwd, candidate));
        if (contents !== undefined) {
          path = candidate;
          source = contents;
          break;
        }
      }
      if (source === undefined) {
        statuses.push({ path, wiring: op.wiring, state: "detached" });
        continue;
      }
      try {
        statuses.push({
          path,
          wiring: op.wiring,
          state: op.edit(source) === source ? "applied" : "detached",
        });
      } catch (error) {
        statuses.push({
          path,
          wiring: op.wiring,
          state: "unknown",
          reason: error instanceof Error ? error.message : "verification failed",
        });
      }
    }
    return statuses;
  }

  /** Shared base artifacts plus the subclass's marker-bearing route files. */
  artifacts(view: PatchView): EjectActions {
    const infrastructure = new Set(this.infrastructureFiles(view));
    const markedFiles = this.routeFiles(view);
    return {
      markedFiles,
      rootConfigFiles: ["zitadel.json"],
      directories: [".zitadel"],
      envBackups: [".env.local"],
      dependencies: this.routeDeps(view),
      configEdits: this.routeConfigEdits(view),
      guidanceFiles: ["AGENTS.md", "README.md"],
      fileClasses: Object.fromEntries(
        markedFiles.map((path) => [path, infrastructure.has(path) ? "infrastructure" : "presentation"]),
      ),
      conditionalFiles: this.conditionallyScaffoldedFiles(view),
      retiredAlternates: this.retiredAlternateFiles(view),
    };
  }

  /**
   * Current marked files mapped to sibling paths that older templates wrote
   * in their place and the framework rejects alongside them. Drives the
   * managed-files boundary migration. Defaults to none; Next overrides it
   * for the `middleware.ts`/`proxy.ts` pair.
   */
  protected retiredAlternateFiles(
    _view: PatchView,
  ): Readonly<Record<string, ReadonlyArray<string>>> {
    return {};
  }

  /**
   * The subset of {@link routeFiles} that is load-bearing for the integration
   * (request boundary, proxies, plugins, type declarations). The `doctor`
   * managed-files check fails when one is missing; everything else is a
   * presentation starting point and only warns. Every patcher whose marked
   * files include plumbing must override this — Next (boundary/provider/dts),
   * Angular (proxy.conf.cjs), and Nuxt (plugins) do. The Vite SPAs' only
   * marked file is the root component (presentation); their plumbing lives in
   * `vite.config.*`, which is a config-edit merge into a user file and out of
   * the file check's reach. Defaults to none.
   */
  protected infrastructureFiles(_view: PatchView): ReadonlyArray<string> {
    return [];
  }

  /**
   * Marked files only written on some scaffolds (e.g. a framework home page
   * that setup replaces only when it created the app skeleton itself). The
   * managed-files check excludes them when no scaffold manifest recorded what
   * was actually written. Defaults to none.
   */
  protected conditionallyScaffoldedFiles(_view: PatchView): ReadonlyArray<string> {
    return [];
  }

  /**
   * User config files this patcher merges into via an `edit` op (e.g.
   * `vite.config.ts`). `eject` can't reverse an in-place merge, so it lists
   * these as manual cleanup steps. Defaults to none; patchers that edit a config
   * (React/Vue/Angular/Nuxt) override it. Next writes whole marker-bearing files
   * instead, so it has none.
   */
  protected routeConfigEdits(_view: PatchView): ReadonlyArray<string> {
    return [];
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
   * state. The `schemas/` and `flows/` directories are created empty here;
   * setup fills them from versioned local defaults after patching.
   * Pure: no filesystem or network.
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
          project_secret: ctx.project.project_secret,
          preview_secret: ctx.project.preview_secret,
          preview_origins: ctx.project.preview_origins,
          created_at: ctx.project.created_at,
        })}\n`,
      },
      { kind: "write", path: "zitadel.json", contents: `${stableStringify(projectConfig(ctx))}\n` },
      {
        kind: "merge-env",
        path: ".env.example",
        entries: {
          ZITADEL_PROJECT_ID: "",
          ZITADEL_PROJECT_SECRET: "",
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
          ZITADEL_PROJECT_SECRET: ctx.project.project_secret,
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
      // The dialect meta-schemas, committed with the project so flow files'
      // relative `$schema` pointers resolve offline (editor validation) and
      // agents can read the flow/schema dialect without the docs site. Their
      // descriptions become editor tooltips inside the generated app, so the
      // `zitadel …` mentions are rewritten to the runnable public form on the
      // way out — the shared source keeps the bare spelling the server wants.
      { kind: "mkdir", path: META_SCHEMA_DIR },
      ...metaSchemaFiles().map(
        (file): FileOp => ({
          kind: "write",
          path: `${META_SCHEMA_DIR}/${file.name}`,
          contents: `${JSON.stringify(normalizePublicCliJson(file.body, ctx.cliVersion), null, 2)}\n`,
        }),
      ),
      // Guidance for humans (README) and agents (AGENTS.md): the golden
      // journey and the customize→plan→apply loop. Marker-fenced managed
      // sections — existing content is never clobbered.
      {
        kind: "edit",
        path: "AGENTS.md",
        edit: (source) => upsertGuidanceSection(source, agentsGuidanceSection(ctx), AGENTS_HEADER),
      },
      {
        kind: "edit",
        path: "README.md",
        edit: (source) => upsertGuidanceSection(source, readmeGuidanceSection(ctx), README_HEADER),
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

/** Reads a text file, mapping every failure to `undefined`. */
async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Builds the `zitadel.json` body persisted at the project root. */
function projectConfig(ctx: PatchContext): Record<string, unknown> {
  const environments: Record<string, unknown> = { development: { issuer: ctx.issuer } };
  if (ctx.project.preview_origins.length > 0) {
    // preview_origins are already full origins (scheme://host[:port]); don't
    // prepend a scheme or it doubles up (https://http://localhost:3000).
    environments.preview = {
      issuer_pattern: [...ctx.project.preview_origins],
    };
  }
  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: ctx.project.id,
    server: resolveServerOrigin(ctx.server),
    framework: { id: ctx.framework.id },
    branding: { renderer: ctx.rendererId, attribution: "visible" },
    environments,
    ...(ctx.preset === undefined ? {} : { preset: ctx.preset }),
    ...(ctx.useCase === undefined ? {} : { useCase: ctx.useCase }),
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
