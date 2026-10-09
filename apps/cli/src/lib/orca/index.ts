import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  reason?: string;
  entries: ReadonlyArray<string>;
}>;

type ScaffoldStash = Readonly<{
  root: string;
  names: ReadonlyArray<string>;
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
  private readonly detectors: ReadonlyArray<Detector>;
  private readonly scaffolders: ReadonlyArray<Scaffolder>;
  private readonly patchers: ReadonlyArray<Patcher>;

  constructor(
    detectors: ReadonlyArray<Detector>,
    scaffolders: ReadonlyArray<Scaffolder>,
    patchers: ReadonlyArray<Patcher>,
  ) {
    this.detectors = detectors;
    this.scaffolders = scaffolders;
    this.patchers = patchers;
  }

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
  async scaffold(cwd: string, framework: string, force = false): Promise<FrameworkFacts> {
    const target = await inspectScaffoldTarget(cwd);
    if (!target.scaffoldable && !force) {
      throw new ZitadelError("E_CONFLICT", `Cannot scaffold: ${cwd} is not empty`, {
        hint:
          `${target.reason ? `${target.reason} ` : ""}Pass --force to scaffold into a ` +
          "non-empty directory, or run setup from an existing supported app project.",
        details: { entries: target.entries },
      });
    }
    assertNpmSafeScaffoldDirectoryName(cwd);
    // The underlying scaffolders require an empty directory. When --force lets us
    // scaffold into a non-empty one, move the existing entries aside, scaffold,
    // then restore anything the scaffold did not create itself.
    const stash = target.scaffoldable ? undefined : await stashScaffoldDir(cwd, target.entries);
    let scaffolded = false;
    try {
      await this.scaffolderFor(framework).scaffold(cwd, framework);
      scaffolded = true;
    } finally {
      await restoreScaffoldDir(cwd, stash, scaffolded);
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
      hint: "Rename the directory to a lowercase npm-package-safe name, for example `my-zitadel-app`, then rerun setup.",
      details: { cwd, name, validation_errors: errors },
    },
  );
}

function npmPackageNameErrors(name: string): string[] {
  // This local preflight catches common package-name failures before the
  // scaffolder mutates disk; framework generators still own stricter checks.
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
    errors.push(
      "name may only contain lowercase letters, numbers, dots, underscores, tildes, and hyphens",
    );
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
  // A fresh scaffold needs an empty directory. We deliberately keep no allowlist
  // of "harmless" entries (`.gitignore`, `.zitadel`, `.claude`, …): that list is
  // a maintenance treadmill, and each tool invents new metadata. Anything present
  // means not-fresh, and `--force` is the single, explicit override.
  const entries = await readdir(cwd);
  const names = [...entries].sort();
  if (names.length === 0) {
    return { scaffoldable: true, entries: names };
  }
  return {
    scaffoldable: false,
    reason: `Directory is not empty (contains ${names.join(", ")}).`,
    entries: names,
  };
}

async function stashScaffoldDir(
  cwd: string,
  names: ReadonlyArray<string>,
): Promise<ScaffoldStash | undefined> {
  if (names.length === 0) {
    return undefined;
  }

  const root = join(
    dirname(cwd),
    `.${basename(cwd)}.fresh-scaffold-stash-${String(process.pid)}-${String(Date.now())}`,
  );
  await mkdir(root, { mode: 0o700 });
  for (const name of names) {
    await rename(join(cwd, name), join(root, name));
  }
  return { root, names };
}

async function restoreScaffoldDir(
  cwd: string,
  stash: ScaffoldStash | undefined,
  succeeded = true,
): Promise<void> {
  if (!stash) {
    return;
  }

  try {
    if (!succeeded) {
      // The scaffold threw. The directory was emptied before scaffolding, so
      // anything in it now is partial output — remove it and put the originals
      // back, so a failed `setup --force` never destroys pre-existing files.
      for (const entry of await readdir(cwd)) {
        await rm(join(cwd, entry), { recursive: true, force: true });
      }
      for (const name of stash.names) {
        await rename(join(stash.root, name), join(cwd, name));
      }
      return;
    }

    for (const name of stash.names) {
      const dest = join(cwd, name);
      if (await pathExists(dest)) {
        // The scaffold created its own file at a stashed name. For `.gitignore`,
        // union the stashed rules back in so ignores the pre-existing setup
        // relied on — notably `.zitadel/local/`, which keeps the local admin
        // credential out of git — are not silently dropped. Any other collision
        // keeps the scaffold's version (that is what `--force` is for).
        if (name === ".gitignore") {
          await mergeGitignore(join(stash.root, name), dest);
        }
      } else {
        // The scaffold left this name free; restore the pre-existing entry.
        await rename(join(stash.root, name), dest);
      }
    }
  } finally {
    await rm(stash.root, { recursive: true, force: true });
  }
}

/** Append any lines from the stashed `.gitignore` that the scaffold's own one lacks. */
async function mergeGitignore(stashed: string, dest: string): Promise<void> {
  const [from, into] = await Promise.all([readFile(stashed, "utf8"), readFile(dest, "utf8")]);
  const present = new Set(into.split("\n").map((line) => line.trim()));
  const missing = from.split("\n").filter((line) => line.trim() && !present.has(line.trim()));
  if (missing.length === 0) {
    return;
  }
  await writeFile(dest, `${into}${into.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
