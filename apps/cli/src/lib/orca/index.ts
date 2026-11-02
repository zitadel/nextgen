import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { isErrno, ZitadelError } from "../errors";
import { pathExists } from "../fs";
import { LOCAL_RUNTIME_DIR } from "../local-server/runtime";
import { detectors } from "./detectors";
import { detectDevPort } from "./detectors/port";
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

/**
 * A new app {@link Orca.scaffoldUndoably} created. Call `keep` or `undo`, once:
 * until then, what the scaffold replaced waits beside the directory.
 */
export type UndoableScaffold = Readonly<{
  facts: FrameworkFacts;
  /** Keeps the new app, and lets go of what it replaced. */
  keep(): Promise<void>;
  /**
   * Removes the new app and what was written into the directory since, and
   * puts back what the directory held: an entry it did not hold goes, and so
   * does one added inside a directory it held; an entry the scaffold replaced
   * comes back. An edit to a file it already held stays.
   */
  undo(): Promise<void>;
}>;

/** A new app {@link Orca.scaffold} can create, as far as it is known before it exists. */
export type PlannedApp = Readonly<{
  framework: string;
  /**
   * The dev port to offer for the app. It has no `dev` script yet to read one
   * from, so this is the port a `.env` file in the directory declares, which
   * the scaffold keeps, else the default.
   */
  devPort: number;
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
   * `E_FRAMEWORK_NOT_DETECTED` when nothing matches, and `E_CONFLICT` when
   * `cwd` holds an app of a framework other than `requested`; a detector's
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
    if (requested) {
      // An app the requested framework's detector does not recognise is still
      // an app. Reported as not detected, it would read as a directory to
      // scaffold into, where `--force` creates a new app over this one.
      for (const detector of this.detectors) {
        if (detector.framework === requested) {
          continue;
        }
        const facts = await detector.detect(cwd);
        if (facts) {
          throw this.frameworkMismatch(requested, facts.id);
        }
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
   * Describes the new `framework` app {@link scaffold} would create in `cwd`,
   * without touching the directory, so a caller can ask its questions first and
   * create the app only once it has every answer. Refuses up front what would
   * stop the app later: a directory name npm does not accept, or a framework
   * no scaffolder can create or no patcher can integrate.
   */
  async planScaffold(cwd: string, framework: string): Promise<PlannedApp> {
    assertNpmSafeScaffoldDirectoryName(cwd);
    this.scaffolderFor(framework);
    this.patcherFor(framework);
    return { framework, devPort: await detectDevPort(cwd, {}) };
  }

  /**
   * Creates a new `framework` project in `cwd`, then re-detects it to return
   * the resulting {@link FrameworkFacts}. Throws `E_CONFLICT` when the directory
   * already contains a project ("already scaffolded") and `E_VALIDATION` when no
   * scaffolder supports the framework.
   */
  async scaffold(cwd: string, framework: string, force = false): Promise<FrameworkFacts> {
    const scaffold = await this.scaffoldUndoably(cwd, framework, force);
    await scaffold.keep();
    return scaffold.facts;
  }

  /**
   * {@link scaffold}, undoable until the caller keeps the new app: for a caller
   * with more to do before the app is worth keeping, which puts the directory
   * back as it was when that fails. A scaffold that fails itself is undone
   * before this throws.
   */
  async scaffoldUndoably(cwd: string, framework: string, force = false): Promise<UndoableScaffold> {
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
    // A directory that does not exist yet is created only now, so a refusal or
    // a dry run leaves no trace of it, and an undo removes it again with any
    // parent it took to create it.
    const created = await mkdir(cwd, { recursive: true });
    const before = await listEntries(cwd);
    // The underlying scaffolders require an empty directory. When it holds the
    // local runtime `start` left, or --force lets us scaffold into a non-empty
    // one, move the existing entries aside, scaffold, then restore anything the
    // scaffold did not create itself.
    const stash = await stashScaffoldDir(cwd, target.entries);
    const undo = () =>
      created === undefined
        ? undoScaffold(cwd, before, stash)
        : rm(created, { recursive: true, force: true });
    let facts: FrameworkFacts;
    try {
      await this.scaffolderFor(framework).scaffold(cwd, framework);
      await restoreBesideScaffold(cwd, stash);
      facts = await this.detect(cwd, framework);
    } catch (error) {
      await undo();
      throw error;
    }
    return { facts, undo, keep: () => dropStash(stash) };
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

  /** A framework's name as people write it ("Next.js" for `next`), or its id when it has none. */
  displayName(id: string): string {
    return this.availableFrameworks().find((framework) => framework.id === id)?.displayName ?? id;
  }

  /** `cwd` holds a `detected` app, and setup was asked to set up a `requested` one. */
  private frameworkMismatch(requested: string, detected: string): ZitadelError {
    const name = (id: string) => this.displayName(id);
    return new ZitadelError(
      "E_CONFLICT",
      `Setup detects ${name(detected)} here, not ${name(requested)}`,
      {
        hint:
          `Rerun setup without --framework, or with --framework ${detected}, to set up this ` +
          `app, or point --cwd at the ${name(requested)} app you meant. Setup never scaffolds ` +
          "a new app over one it detects, --force or not.",
        details: { requested, detected },
      },
    );
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
  // of other tools' "harmless" entries (`.claude`, editor settings, …): that list
  // is a maintenance treadmill, and each tool invents new metadata. Anything
  // present means not-fresh, and `--force` is the single, explicit override.
  //
  // The one exception is what `zitadel start` itself leaves, so that `start`
  // and then `setup` work in a new directory: the local runtime, and the
  // `.gitignore` line that keeps it out of git. `scaffold()` moves both aside
  // while the generator runs and merges the `.gitignore` back.
  const names = [...(await scaffoldTargetEntries(cwd))].sort();
  const others: string[] = [];
  for (const name of names) {
    if (!(await isLocalRuntimeEntry(cwd, name))) {
      others.push(name);
    }
  }
  if (others.length === 0) {
    return { scaffoldable: true, entries: names };
  }
  return {
    scaffoldable: false,
    reason: `Directory is not empty (contains ${others.join(", ")}).`,
    entries: names,
  };
}

/**
 * The entries of a scaffold target, or none when it does not exist yet: the
 * scaffold creates it, as a framework's own generator creates `my-app`, so a
 * `--cwd` naming the new app's directory works before that directory does.
 */
async function scaffoldTargetEntries(cwd: string): Promise<string[]> {
  try {
    return await readdir(cwd);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

/**
 * Refuses a project directory that is a file, or lies under one, before
 * anything reads inside it. One that does not exist yet passes: a scaffold
 * creates it.
 */
export async function assertDirectoryOrMissing(cwd: string): Promise<void> {
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(cwd)).isDirectory();
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return;
    }
    if (!isErrno(error, "ENOTDIR")) {
      throw error;
    }
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new ZitadelError("E_VALIDATION", `${cwd} is not a directory`, {
      hint: "Point --cwd at the app's directory, or at one that does not exist yet for setup to create.",
    });
  }
}

/**
 * Whether `name` in `cwd` is one of the entries `zitadel start` writes
 * (`ensureLocalState`): a `.zitadel` that holds nothing but the local runtime,
 * or a `.gitignore` that holds nothing but the line ignoring it. Either may be
 * empty once `reset` has removed the runtime.
 */
async function isLocalRuntimeEntry(cwd: string, name: string): Promise<boolean> {
  try {
    if (name === dirname(LOCAL_RUNTIME_DIR)) {
      const inside = await readdir(join(cwd, name));
      return inside.every((entry) => entry === basename(LOCAL_RUNTIME_DIR));
    }
    if (name === ".gitignore") {
      const lines = (await readFile(join(cwd, name), "utf8")).split(/\r?\n/);
      return lines.every((line) => ["", `${LOCAL_RUNTIME_DIR}/`].includes(line.trim()));
    }
  } catch {
    // Not a directory, or not a readable file: not what `start` wrote.
  }
  return false;
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
  const moved: string[] = [];
  try {
    for (const name of names) {
      await rename(join(cwd, name), join(root, name));
      moved.push(name);
    }
  } catch (error) {
    // Put back what already moved, so a stash that fails halfway leaves the
    // directory as it was rather than stranding entries in the stash.
    for (const name of moved) {
      await rename(join(root, name), join(cwd, name));
    }
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return { root, names };
}

/**
 * Moves back each stashed entry the scaffold left free. An entry the scaffold
 * created its own file at stays in the stash, so an undo can put it back.
 */
async function restoreBesideScaffold(cwd: string, stash: ScaffoldStash | undefined): Promise<void> {
  if (!stash) {
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
}

/**
 * What a directory holds: each entry, with the entries inside it when it is a
 * directory, so an undo can tell what was added since.
 */
type DirectoryListing = ReadonlyMap<string, ReadonlySet<string> | undefined>;

async function listEntries(cwd: string): Promise<DirectoryListing> {
  const listing = new Map<string, ReadonlySet<string> | undefined>();
  for (const entry of await readdir(cwd, { withFileTypes: true })) {
    listing.set(
      entry.name,
      entry.isDirectory() ? new Set(await readdir(join(cwd, entry.name))) : undefined,
    );
  }
  return listing;
}

/**
 * Puts `cwd` back to `before`: removes what the scaffold and anything after
 * it added, including entries added inside a directory `cwd` already held,
 * then moves back what is still in the stash, which the scaffold replaced or
 * a failure kept from coming back.
 */
async function undoScaffold(
  cwd: string,
  before: DirectoryListing,
  stash: ScaffoldStash | undefined,
): Promise<void> {
  const stashed = new Set(stash ? await readdir(stash.root) : []);
  for (const entry of await readdir(cwd)) {
    const inside = before.get(entry);
    if (!before.has(entry) || stashed.has(entry)) {
      await rm(join(cwd, entry), { recursive: true, force: true });
    } else if (inside !== undefined) {
      for (const child of await readdir(join(cwd, entry))) {
        if (!inside.has(child)) {
          await rm(join(cwd, entry, child), { recursive: true, force: true });
        }
      }
    }
  }
  if (stash) {
    for (const name of stashed) {
      await rename(join(stash.root, name), join(cwd, name));
    }
  }
  await dropStash(stash);
}

async function dropStash(stash: ScaffoldStash | undefined): Promise<void> {
  if (stash) {
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
