import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { EjectActions } from "../../../lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../lib/paths";
import { readRendererId, readZitadelConfig } from "../../../lib/project";
import {
  hashScaffoldFile,
  readScaffoldManifest,
  writeScaffoldManifest,
} from "../../../lib/scaffold-manifest";
import { updateScaffold } from "../../../lib/sync/state";
import type { ScaffoldFileClass, ScaffoldManifest } from "../../../lib/sync/types";
import { loadPatchContext } from "../patch-context";
import type { CheckContext, CheckOutcome, SanityCheck } from "./types";

/**
 * Per-file classification reported in the check's `details`:
 *
 * - `pristine` — still the bytes setup wrote (manifest hash matches).
 * - `edited` — carries the managed marker but the content changed; the user
 *   extended a managed file (e.g. added routes to the request boundary).
 * - `adopted` — the marker is gone; the user replaced the file and owns it
 *   now (mirrors `eject`, which preserves marker-less files).
 * - `managed` — marker present; used in template mode, where no recorded
 *   hash exists to tell pristine from edited.
 * - `missing` — the file is gone. Infrastructure ⇒ fail, presentation ⇒ warn.
 */
type ScaffoldFileState = "pristine" | "edited" | "adopted" | "managed" | "missing";

type ScaffoldFileRow = {
  path: string;
  class: ScaffoldFileClass;
  state: ScaffoldFileState;
};

/**
 * Verifies the scaffolded app files still exist: the ones `zitadel setup`
 * wrote per the scaffold manifest in `.zitadel/state.json`, or — for apps
 * scaffolded before the manifest existed — the patcher's current template
 * expectations minus conditionally-written files. A missing *infrastructure*
 * file (request boundary, provider, type declarations) breaks the auth
 * integration and fails the check; a missing *presentation* page only warns.
 * Edited and user-adopted files pass — they are the intended customization
 * paths — and are labelled in `details` for visibility.
 *
 * Implements {@link SanityCheck} directly rather than via the abstract base:
 * the base's `verify`-throws contract can only express pass/fail, and this
 * check needs the `warn` outcome.
 */
export class ManagedFilesCheck implements SanityCheck {
  readonly name = "managed-files";

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    const manifest = await readScaffoldManifest(ctx.cwd);
    const evaluated = manifest
      ? await evaluateManifest(ctx.cwd, manifest)
      : await evaluateTemplates(ctx);
    if (!evaluated) {
      return {
        name: this.name,
        status: "warn",
        message:
          "Could not enumerate scaffolded app files (framework or renderer unresolved); skipping the file check",
      };
    }

    const { mode, rows } = evaluated;
    const missing = rows.filter((row) => row.state === "missing");
    const missingInfrastructure = missing.filter((row) => row.class === "infrastructure");
    const details = { mode, files: rows };

    if (missingInfrastructure.length > 0) {
      return {
        name: this.name,
        status: "fail",
        message: `missing scaffolded infrastructure file(s): ${listPaths(missingInfrastructure)}`,
        details,
      };
    }
    if (missing.length > 0) {
      return {
        name: this.name,
        status: "warn",
        message: `missing scaffolded page(s): ${listPaths(missing)}`,
        details,
      };
    }
    return {
      name: this.name,
      status: "pass",
      message: `Scaffolded app files are present (${rows.length} tracked${
        mode === "template" ? ", from templates" : ""
      })`,
      details,
    };
  }

  /**
   * Restores missing managed files via the patcher's missing-only repair —
   * existing files, edited or adopted, are never overwritten — then refreshes
   * the manifest hashes of the files the repair brought back so they classify
   * as pristine again. The restored bytes come from the *current* templates,
   * which may differ from what the original CLI version wrote; the re-hash
   * records that honestly. On a pre-manifest app (template mode) a successful
   * repair also materializes the manifest from the marker-bearing files now
   * on disk, completing the migration ADR 042 promises — adopted files stay
   * the user's and are not recorded.
   */
  async fix(ctx: CheckContext): Promise<void> {
    const manifest = await readScaffoldManifest(ctx.cwd);
    const missingBefore = manifest ? await missingManifestPaths(ctx.cwd, manifest) : [];
    const patchCtx = await loadPatchContext(ctx.cwd, ctx.orca, ctx.cliVersion);
    const patcher = ctx.orca.patcherFor(patchCtx.framework.id);
    await patcher.repair(patchCtx, {
      cwd: ctx.cwd,
      dryRun: ctx.dryRun,
      force: false,
      missingOnly: true,
    });
    if (ctx.dryRun) {
      return;
    }
    if (!manifest) {
      await materializeManifest(ctx, patchCtx);
      return;
    }
    if (missingBefore.length === 0) {
      return;
    }
    const files = { ...manifest.files };
    for (const path of missingBefore) {
      const contents = await readIfExists(join(ctx.cwd, path));
      if (contents === undefined) {
        continue;
      }
      const entry = files[path];
      if (entry) {
        files[path] = { ...entry, hash: hashScaffoldFile(contents) };
      }
    }
    await updateScaffold(ctx.cwd, { ...manifest, files });
  }
}

/**
 * Migration path for apps scaffolded before the manifest existed: after a
 * template-mode repair, record the marker-bearing managed files now on disk
 * so the next doctor run gets exact manifest-mode verification instead of
 * template guessing (and its Next-major / template-growth misclassification
 * risk). Marker-less (adopted) files and conditionally-scaffolded ones are
 * deliberately absent. Best-effort: an unreadable state file leaves the app
 * in template mode, same as before.
 */
async function materializeManifest(
  ctx: CheckContext,
  patchCtx: Awaited<ReturnType<typeof loadPatchContext>>,
): Promise<void> {
  try {
    const actions = ctx.orca.patcherFor(patchCtx.framework.id).artifacts({
      framework: patchCtx.framework,
      rendererId: patchCtx.rendererId,
    });
    const conditional = new Set(actions.conditionalFiles ?? []);
    const marked: string[] = [];
    for (const path of actions.markedFiles) {
      if (conditional.has(path)) {
        continue;
      }
      const contents = await readIfExists(join(ctx.cwd, path));
      if (contents !== undefined && contents.includes(MANAGED_MARKER)) {
        marked.push(path);
      }
    }
    await writeScaffoldManifest({ cwd: ctx.cwd, actions, written: marked });
  } catch {
    // state.json unreadable or the write raced — stays in template mode.
  }
}

async function evaluateManifest(
  cwd: string,
  manifest: ScaffoldManifest,
): Promise<{ mode: "manifest"; rows: ScaffoldFileRow[] }> {
  const rows: ScaffoldFileRow[] = [];
  for (const [path, entry] of Object.entries(manifest.files)) {
    const contents = await readIfExists(join(cwd, path));
    rows.push({ path, class: entry.class, state: stateFor(contents, entry.hash) });
  }
  return { mode: "manifest", rows };
}

/**
 * Fallback for apps scaffolded before the manifest existed: derive the
 * expected set from the patcher's current templates. Conditionally-written
 * files (e.g. the framework home page) are excluded — without a manifest
 * there is no way to know whether setup ever wrote them. Presence-only:
 * no recorded hash means `pristine` vs `edited` cannot be told apart.
 */
async function evaluateTemplates(
  ctx: CheckContext,
): Promise<{ mode: "template"; rows: ScaffoldFileRow[] } | undefined> {
  const actions = await resolveArtifacts(ctx);
  if (!actions) {
    return undefined;
  }
  const conditional = new Set(actions.conditionalFiles ?? []);
  const rows: ScaffoldFileRow[] = [];
  for (const path of actions.markedFiles) {
    if (conditional.has(path)) {
      continue;
    }
    const contents = await readIfExists(join(ctx.cwd, path));
    rows.push({
      path,
      class: actions.fileClasses?.[path] ?? "presentation",
      state: stateFor(contents, undefined),
    });
  }
  return { mode: "template", rows };
}

/**
 * Resolves the patcher artifacts the same way `eject` does, tolerating every
 * failure with `undefined`: a broken framework detection, an unreadable
 * config, or an unresolvable renderer are reported by their own checks —
 * this one only degrades to "cannot enumerate".
 */
async function resolveArtifacts(ctx: CheckContext): Promise<EjectActions | undefined> {
  const framework = await ctx.orca.tryDetect(ctx.cwd);
  if (!framework) {
    return undefined;
  }
  try {
    const config = await readZitadelConfig(ctx.cwd).catch(() => ({}) as Record<string, unknown>);
    return ctx.orca.patcherFor(framework.id).artifacts({
      framework,
      rendererId: readRendererId(config),
    });
  } catch {
    return undefined;
  }
}

function stateFor(contents: string | undefined, hash: string | undefined): ScaffoldFileState {
  if (contents === undefined) {
    return "missing";
  }
  if (!contents.includes(MANAGED_MARKER)) {
    return "adopted";
  }
  if (hash === undefined) {
    return "managed";
  }
  return hashScaffoldFile(contents) === hash ? "pristine" : "edited";
}

async function missingManifestPaths(cwd: string, manifest: ScaffoldManifest): Promise<string[]> {
  const missing: string[] = [];
  for (const path of Object.keys(manifest.files)) {
    if ((await readIfExists(join(cwd, path))) === undefined) {
      missing.push(path);
    }
  }
  return missing;
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function listPaths(rows: ReadonlyArray<ScaffoldFileRow>): string {
  return rows.map((row) => row.path).join(", ");
}
