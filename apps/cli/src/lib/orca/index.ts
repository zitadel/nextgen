import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { ZitadelError } from "../errors";
import { detectors } from "./detectors";
import type { Detector, FrameworkFacts } from "./detectors/types";
import { patchers } from "./patchers";
import type { Patcher } from "./patchers/types";
import { scaffolders } from "./scaffolders";
import type { Scaffolder } from "./scaffolders/types";

export type { Detector, FrameworkFacts } from "./detectors/types";
export { issuerFromPort } from "./detectors/port";

/** One framework the CLI can scaffold from scratch, surfaced to the picker. */
export type FrameworkChoice = Readonly<{ id: string; displayName: string }>;

export type ScaffoldTarget = Readonly<{
  scaffoldable: boolean;
  hasGitignore: boolean;
  hasRuntimeOnlyZitadel: boolean;
  reason?: string;
  entries: ReadonlyArray<string>;
}>;

type ScaffoldStash = Readonly<{
  gitignore?: string;
  root: string;
  zitadel?: string;
}>;

/**
 * Orchestrates the three per-framework strategies — detectors (recognise an
 * existing project and extract its facts), scaffolders (create a project), and
 * patchers (integrate Zitadel) — over their respective registries. It resolves
 * the right strategy for a framework and drives the detect/scaffold lifecycle;
 * how a patcher applies its work (file operations vs an LLM agent) stays
 * internal to that patcher. Registries are injected so tests can supply fakes.
 */
export class Orca {
  constructor(
    private readonly detectors: ReadonlyArray<Detector>,
    private readonly scaffolders: ReadonlyArray<Scaffolder>,
    private readonly patchers: ReadonlyArray<Patcher>,
  ) {}

  /**
   * Detects the framework in `cwd` and extracts its {@link FrameworkFacts},
   * honouring an explicit `requested` framework. Throws
   * `E_FRAMEWORK_NOT_DETECTED` when nothing matches; a detector's
   * `E_UNSUPPORTED_PROJECT_SHAPE` (recognised but unsupported) propagates.
   */
  async detect(cwd: string, requested?: string): Promise<FrameworkFacts> {
    const candidates = requested
      ? this.detectors.filter((detector) => detector.framework === requested)
      : this.detectors;
    if (requested && candidates.length === 0) {
      throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", `Unsupported framework "${requested}"`, {
        hint: `Supported frameworks: ${this.frameworkIds().join(", ")}.`,
      });
    }
    for (const detector of candidates) {
      const facts = await detector.detect(cwd);
      if (facts) {
        return facts;
      }
    }
    throw new ZitadelError(
      "E_FRAMEWORK_NOT_DETECTED",
      "Could not detect a supported app framework",
      {
        hint: "Run setup from your app project directory, pass --cwd <path-to-app>, or run setup from an empty directory to scaffold a new app.",
      },
    );
  }

  /**
   * Non-throwing detection: returns `undefined` instead of raising for a
   * project that is absent, unrecognised, or recognised-but-unsupported, so
   * callers (e.g. `eject`) can probe and degrade gracefully.
   */
  async tryDetect(cwd: string): Promise<FrameworkFacts | undefined> {
    try {
      return await this.detect(cwd);
    } catch (error) {
      if (
        error instanceof ZitadelError &&
        (error.code === "E_FRAMEWORK_NOT_DETECTED" || error.code === "E_UNSUPPORTED_PROJECT_SHAPE")
      ) {
        return undefined;
      }
      throw error;
    }
  }

  /** Whether `cwd` is safe for an in-place framework scaffold. */
  async isFreshScaffoldTarget(cwd: string): Promise<boolean> {
    return (await inspectScaffoldTarget(cwd)).scaffoldable;
  }

  /**
   * Creates a new `framework` project in `cwd`, then re-detects it to return
   * the resulting {@link FrameworkFacts}. Throws `E_CONFLICT` when the directory
   * already contains a project ("already scaffolded") and `E_VALIDATION` when no
   * scaffolder supports the framework.
   */
  async scaffold(cwd: string, framework: string): Promise<FrameworkFacts> {
    const target = await inspectScaffoldTarget(cwd);
    if (!target.scaffoldable) {
      throw new ZitadelError("E_CONFLICT", `Cannot scaffold: ${cwd} is not empty`, {
        hint:
          target.reason ??
          "Run setup in an empty directory, or run setup from an existing supported app project.",
        details: { entries: target.entries },
      });
    }
    assertNpmSafeScaffoldDirectoryName(cwd);
    const stash = await stashFreshScaffoldArtifacts(cwd, target);
    try {
      await this.scaffolderFor(framework).scaffold(cwd, framework);
    } finally {
      await restoreFreshScaffoldArtifacts(cwd, stash);
    }
    return this.detect(cwd, framework);
  }

  /**
   * Resolves the scaffolder for a framework, throwing `E_VALIDATION` (with the
   * available list) when none matches.
   */
  scaffolderFor(framework: string): Scaffolder {
    const scaffolder = this.scaffolders.find((candidate) => candidate.canScaffold(framework));
    if (!scaffolder) {
      throw new ZitadelError("E_VALIDATION", `No scaffolder supports "${framework}"`, {
        hint: `Available frameworks: ${this.availableFrameworks()
          .map((f) => f.id)
          .join(", ")}.`,
      });
    }
    return scaffolder;
  }

  /**
   * Resolves the patcher for a framework, throwing `E_VALIDATION` when none
   * matches (e.g. a framework that can be scaffolded but not yet integrated).
   */
  patcherFor(framework: string): Patcher {
    const patcher = this.patchers.find((candidate) => candidate.canPatch(framework));
    if (!patcher) {
      throw new ZitadelError("E_VALIDATION", `No patcher supports "${framework}"`, {
        hint: "Zitadel integration currently supports Next.js.",
      });
    }
    return patcher;
  }

  /** The frameworks that can be scaffolded, derived from the scaffolder registry. */
  availableFrameworks(): ReadonlyArray<FrameworkChoice> {
    return this.scaffolders.map((scaffolder) => ({
      id: scaffolder.supportedFrameworks[0] ?? scaffolder.displayName,
      displayName: scaffolder.displayName,
    }));
  }

  private frameworkIds(): ReadonlyArray<string> {
    return this.detectors.map((detector) => detector.framework);
  }
}

function assertNpmSafeScaffoldDirectoryName(cwd: string): void {
  const name = basename(cwd);
  const errors = npmPackageNameErrors(name);
  if (errors.length === 0) {
    return;
  }

  throw new ZitadelError(
    "E_VALIDATION",
    `Fresh app directory name "${name}" is not npm-package-safe`,
    {
      hint:
        "Rename the directory to a lowercase npm-package-safe name, for example `my-zitadel-app`, then rerun setup.",
      details: { cwd, name, validation_errors: errors },
    },
  );
}

function npmPackageNameErrors(name: string): string[] {
  const errors: string[] = [];
  if (name.length === 0) {
    errors.push("name is empty");
  }
  if (name.length > 214) {
    errors.push("name is longer than 214 characters");
  }
  if (name !== name.trim()) {
    errors.push("name contains leading or trailing whitespace");
  }
  if (/[A-Z]/.test(name)) {
    errors.push("name can no longer contain capital letters");
  }
  if (name.startsWith(".") || name.startsWith("_")) {
    errors.push("name cannot start with a period or underscore");
  }
  if (!/^[a-z0-9][a-z0-9._~-]*$/.test(name)) {
    errors.push("name may only contain lowercase letters, numbers, dots, underscores, tildes, and hyphens");
  }
  if (name === "node_modules" || name === "favicon.ico") {
    errors.push(`name "${name}" is reserved`);
  }
  return [...new Set(errors)];
}

/** {@link Orca} wired with the default detector, scaffolder, and patcher registries. */
export function createOrca(): Orca {
  return new Orca(detectors, scaffolders, patchers);
}

export async function inspectScaffoldTarget(cwd: string): Promise<ScaffoldTarget> {
  const entries = await readdir(cwd, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  let hasGitignore = false;
  let hasRuntimeOnlyZitadel = false;

  for (const entry of entries) {
    if (entry.name === ".gitignore") {
      if (!entry.isFile()) {
        return {
          scaffoldable: false,
          hasGitignore: false,
          hasRuntimeOnlyZitadel: false,
          reason: ".gitignore exists but is not a file.",
          entries: names,
        };
      }
      hasGitignore = true;
      continue;
    }

    if (entry.name === ".zitadel") {
      if (!entry.isDirectory() || !(await isRuntimeOnlyZitadelDir(join(cwd, ".zitadel")))) {
        return {
          scaffoldable: false,
          hasGitignore,
          hasRuntimeOnlyZitadel: false,
          reason:
            ".zitadel contains project state. Move it aside or run setup from an empty app directory.",
          entries: names,
        };
      }
      hasRuntimeOnlyZitadel = true;
      continue;
    }

    return {
      scaffoldable: false,
      hasGitignore,
      hasRuntimeOnlyZitadel: false,
      reason: `Directory contains ${entry.name}. Run setup from an empty directory to scaffold a new app.`,
      entries: names,
    };
  }

  return { scaffoldable: true, hasGitignore, hasRuntimeOnlyZitadel, entries: names };
}

async function isRuntimeOnlyZitadelDir(path: string): Promise<boolean> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length !== 1 || entries[0]?.name !== "local" || !entries[0].isDirectory()) {
    return false;
  }
  return true;
}

async function stashFreshScaffoldArtifacts(
  cwd: string,
  target: ScaffoldTarget,
): Promise<ScaffoldStash | undefined> {
  if (!target.hasGitignore && !target.hasRuntimeOnlyZitadel) {
    return undefined;
  }

  const parent = dirname(cwd);
  const root = join(
    parent,
    `.${basename(cwd)}.fresh-scaffold-stash-${String(process.pid)}-${String(Date.now())}`,
  );
  await mkdir(root, { mode: 0o700 });

  const stash: { gitignore?: string; root: string; zitadel?: string } = { root };
  if (target.hasRuntimeOnlyZitadel) {
    stash.zitadel = join(root, ".zitadel");
    await rename(join(cwd, ".zitadel"), stash.zitadel);
  }
  if (target.hasGitignore) {
    stash.gitignore = join(root, ".gitignore");
    await rename(join(cwd, ".gitignore"), stash.gitignore);
  }
  return stash;
}

async function restoreFreshScaffoldArtifacts(
  cwd: string,
  stash: ScaffoldStash | undefined,
): Promise<void> {
  if (!stash) {
    return;
  }

  try {
    await restoreRuntimeOnlyZitadel(cwd, stash.zitadel);
    await restoreGitignore(cwd, stash.gitignore);
  } finally {
    await rm(stash.root, { recursive: true, force: true });
  }
}

async function restoreRuntimeOnlyZitadel(cwd: string, stash: string | undefined): Promise<void> {
  if (!stash) {
    return;
  }

  const target = join(cwd, ".zitadel");
  try {
    await rename(stash, target);
    await appendGitignoreEntry(cwd, ".zitadel/local/");
    return;
  } catch (error) {
    if (!isErrno(error, "EEXIST")) {
      throw error;
    }
  }

  await mkdir(target, { recursive: true, mode: 0o700 });
  await rename(join(stash, "local"), join(target, "local"));
  await rm(stash, { recursive: true, force: true });
  await appendGitignoreEntry(cwd, ".zitadel/local/");
}

async function restoreGitignore(cwd: string, stash: string | undefined): Promise<void> {
  if (!stash) {
    return;
  }

  const path = join(cwd, ".gitignore");
  const stashed = await readFile(stash, "utf8");
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }

  const existingLines = new Set(
    current
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missingLines = stashed
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !existingLines.has(line));
  if (missingLines.length === 0) {
    return;
  }

  const prefix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${current}${prefix}${missingLines.join("\n")}\n`);
}

async function appendGitignoreEntry(cwd: string, entry: string): Promise<void> {
  const path = join(cwd, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      throw error;
    }
  }

  const lines = existing.split(/\r?\n/g).map((line) => line.trim());
  if (lines.includes(entry)) {
    return;
  }
  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${existing}${prefix}${entry}\n`);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
