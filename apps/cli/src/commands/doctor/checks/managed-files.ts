import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ConfigWiringStatus, EjectActions } from "../../../lib/orca/patchers/types";
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
    const wiring = await probeConfigWiring(ctx);
    const actions = await resolveArtifacts(ctx);
    const boundaries = actions
      ? await detectBoundaryConflicts(actions, ctx.cwd, manifest)
      : [];
    const missing = rows.filter((row) => row.state === "missing");
    const missingInfrastructure = missing.filter((row) => row.class === "infrastructure");
    const detachedInfrastructure = wiring.filter(
      (s) => s.state === "detached" && s.wiring === "infrastructure",
    );
    const detachedConvenience = wiring.filter(
      (s) => s.state === "detached" && s.wiring === "convenience",
    );
    const unverifiable = wiring.filter((s) => s.state === "unknown");
    const conflicts = boundaries.filter((b) => b.disposition === "conflict");
    const removable = boundaries.filter((b) => b.disposition === "removable");
    const details = {
      mode,
      files: rows,
      ...(wiring.length > 0 ? { config_wiring: wiring } : {}),
      ...(boundaries.length > 0 ? { boundary_conflicts: boundaries } : {}),
    };

    const failures: string[] = [];
    if (missingInfrastructure.length > 0) {
      failures.push(
        `missing scaffolded infrastructure file(s): ${listPaths(missingInfrastructure)}`,
      );
    }
    if (detachedInfrastructure.length > 0) {
      failures.push(
        `detached managed config wiring: ${detachedInfrastructure
          .map((s) => s.path)
          .join(", ")}`,
      );
    }
    for (const conflict of conflicts) {
      failures.push(
        `conflicting request boundaries: ${conflict.retired} is user-modified while the current templates use ${conflict.current} — migrate your changes and remove one of them manually`,
      );
    }
    if (failures.length > 0) {
      return { name: this.name, status: "fail", message: failures.join("; "), details };
    }

    const warnings: string[] = [];
    if (missing.length > 0) {
      warnings.push(`missing scaffolded page(s): ${listPaths(missing)}`);
    }
    if (detachedConvenience.length > 0) {
      warnings.push(
        `unapplied managed config edit(s): ${detachedConvenience.map((s) => s.path).join(", ")}`,
      );
    }
    if (unverifiable.length > 0) {
      warnings.push(
        `unverifiable managed config wiring (manual review required): ${unverifiable
          .map((s) => (s.reason ? `${s.path} (${s.reason})` : s.path))
          .join(", ")}`,
      );
    }
    for (const leftover of removable) {
      warnings.push(
        `retired boundary ${leftover.retired} left over from a template migration (doctor --fix removes it and installs ${leftover.current})`,
      );
    }
    if (warnings.length > 0) {
      return { name: this.name, status: "warn", message: warnings.join("; "), details };
    }

    return {
      name: this.name,
      status: "pass",
      message: `Scaffolded app files are present (${rows.length} tracked${
        wiring.length > 0 ? `, ${wiring.length} wiring${wiring.length === 1 ? "" : "s"} verified` : ""
      }${mode === "template" ? ", from templates" : ""})`,
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
    const actions = patcher.artifacts({
      framework: patchCtx.framework,
      rendererId: patchCtx.rendererId,
    });
    // Boundary migration: a *pristine* retired alternate (hash-proven CLI
    // bytes, e.g. Next 15's middleware.ts after an upgrade) is removed so the
    // current boundary can be installed without the framework rejecting the
    // pair. A user-modified or adopted alternate is a conflict: it stays, and
    // the current boundary is excluded from the repair — creating proxy.ts
    // beside an edited middleware.ts would break the build outright. Dry-run
    // deletes nothing and keeps the exclusion, so the preview stays safe.
    const boundaries = await detectBoundaryConflicts(actions, ctx.cwd, manifest);
    const excludePaths = boundaries
      .filter((b) => b.disposition === "conflict")
      .map((b) => b.current);
    const removed: string[] = [];
    if (!ctx.dryRun) {
      for (const boundary of boundaries) {
        if (boundary.disposition === "removable") {
          await rm(join(ctx.cwd, boundary.retired), { force: true });
          removed.push(boundary.retired);
        }
      }
    }
    await patcher.repair(patchCtx, {
      cwd: ctx.cwd,
      dryRun: ctx.dryRun,
      force: false,
      missingOnly: true,
      ...(excludePaths.length > 0 ? { excludePaths } : {}),
    });
    if (ctx.dryRun) {
      return;
    }
    if (!manifest) {
      await materializeManifest(ctx, patchCtx);
      return;
    }
    if (missingBefore.length === 0 && removed.length === 0) {
      return;
    }
    // Reconcile the manifest with the current template set before rewriting
    // it. Template migrations (Next 15's middleware.ts → Next 16's proxy.ts)
    // retire paths the current plan no longer writes: repair restores the
    // *new* boundary, so a retired entry whose file stays absent must be
    // dropped — keeping it would fail doctor forever, since setup skips
    // initialized projects. Paths the repair newly introduced are adopted
    // with their class and on-disk hash.
    const current = new Set(actions.markedFiles);
    const conditional = new Set(actions.conditionalFiles ?? []);
    const files: ScaffoldManifest["files"] = {};
    for (const [path, entry] of Object.entries(manifest.files)) {
      const contents = await readIfExists(join(ctx.cwd, path));
      if (contents === undefined && !current.has(path)) {
        continue; // retired by a template migration and gone from disk
      }
      files[path] =
        contents !== undefined && missingBefore.includes(path)
          ? { ...entry, hash: hashScaffoldFile(contents) }
          : entry;
    }
    for (const path of actions.markedFiles) {
      if (files[path] || conditional.has(path)) {
        continue;
      }
      const contents = await readIfExists(join(ctx.cwd, path));
      if (contents !== undefined && contents.includes(MANAGED_MARKER)) {
        files[path] = {
          hash: hashScaffoldFile(contents),
          class: actions.fileClasses?.[path] ?? "presentation",
        };
      }
    }
    await updateScaffold(ctx.cwd, { ...manifest, files });
  }
}

/**
 * A retired template alternate (an old boundary filename) that still exists
 * beside — or instead of — the file the current templates write.
 * `removable`: hash-proven pristine CLI bytes per the manifest, safe for
 * `--fix` to delete during migration. `conflict`: user-modified, adopted, or
 * simply unhashable (template mode) — never deleted, and the current
 * counterpart must not be created next to it.
 */
type BoundaryConflict = {
  current: string;
  retired: string;
  disposition: "removable" | "conflict";
};

async function detectBoundaryConflicts(
  actions: EjectActions,
  cwd: string,
  manifest: ScaffoldManifest | undefined,
): Promise<BoundaryConflict[]> {
  const conflicts: BoundaryConflict[] = [];
  for (const [current, retiredPaths] of Object.entries(actions.retiredAlternates ?? {})) {
    for (const retired of retiredPaths) {
      const contents = await readIfExists(join(cwd, retired));
      if (contents === undefined) {
        continue;
      }
      const entry = manifest?.files[retired];
      const pristine =
        entry !== undefined &&
        contents.includes(MANAGED_MARKER) &&
        hashScaffoldFile(contents) === entry.hash;
      conflicts.push({ current, retired, disposition: pristine ? "removable" : "conflict" });
    }
  }
  return conflicts;
}

/**
 * Probe the patcher's managed config wirings (dev proxy merges, route
 * registrations). Needs the full patch context (project secret et al) to
 * rebuild the plan; when that fails — missing secret, undetectable
 * framework — the probe is skipped silently and the responsible check
 * reports the real problem.
 */
async function probeConfigWiring(
  ctx: CheckContext,
): Promise<ReadonlyArray<ConfigWiringStatus>> {
  try {
    const patchCtx = await loadPatchContext(ctx.cwd, ctx.orca, ctx.cliVersion);
    return await ctx.orca
      .patcherFor(patchCtx.framework.id)
      .verify(patchCtx, { cwd: ctx.cwd });
  } catch {
    return [];
  }
}

/**
 * Migration path for apps scaffolded before the manifest existed: after a
 * template-mode repair, record the marker-bearing managed files now on disk
 * so the next doctor run gets exact manifest-mode verification instead of
 * template guessing (and its Next-major / template-growth misclassification
 * risk). Marker-less (adopted) files and conditionally-scaffolded ones are
 * deliberately absent.
 *
 * The manifest is only finalized when every current *infrastructure* file is
 * present and recordable (marker-bearing): materializing during an
 * unresolved boundary conflict — or over an adopted boundary — would write a
 * manifest that tracks no request boundary at all, and deleting the boundary
 * later would go undetected. Until then the app stays on the template
 * fallback, whose presence checks keep enforcing the boundary. Best-effort:
 * an unreadable state file leaves the app in template mode, same as before.
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
    const infrastructure = actions.markedFiles.filter(
      (path) => actions.fileClasses?.[path] === "infrastructure" && !conditional.has(path),
    );
    if (!infrastructure.every((path) => marked.includes(path))) {
      return;
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
