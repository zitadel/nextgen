import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import fse from "fs-extra";

import { ZitadelError } from "@/lib/errors";
import { isErrno } from "@/lib/errno";
import { pathExists, readDirIfExists } from "@/lib/fs";

import { detectors } from "./detectors";
import { detectDevPort } from "./detectors/port";
import type { Detector, FrameworkFacts } from "./detectors/types";
import { ManagedFile } from "./managed-file";
import { patchers } from "./patchers";
import type { Patcher } from "./patchers/types";
import { ScaffoldManifestFile } from "./scaffold-manifest";
import type { ScaffoldManifest } from "@/lib/sync/types";
import { scaffolders } from "./scaffolders";
import type { Scaffolder } from "./scaffolders/types";

export { issuerFromPort } from "./detectors/port";
export type { Detector, FrameworkFacts } from "./detectors/types";

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

/** The directories a scaffold into a non-empty project uses, all beside the project. */
type ScaffoldWorkspace = Readonly<{
  /** Holds the other two; removing it removes both. */
  dir: string;
  /** The empty directory the scaffold runs in. */
  work: string;
  /** Receives what the scaffold replaces, so an undo can put it back. Made when first used. */
  backup: string;
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
  /**
   * Whether a file's text says the CLI generated it and still owns it, which is what `doctor` and
   * `eject` ask before they touch a file.
   *
   * @param contents - The file's text.
   * @returns `true` when the text carries the managed-file marker.
   */
  static isManaged(contents: string): boolean {
    return new ManagedFile(contents).isManaged();
  }

  /**
   * The content hash of one scaffolded file, as the scaffold manifest records
   * it: of the raw text, answering "are these still the bytes setup wrote?".
   *
   * @param contents - The file's text.
   * @returns The hash.
   */
  static scaffoldHash(contents: string): string {
    return ScaffoldManifestFile.hash(contents);
  }

  /**
   * Reads the scaffold manifest from `.zitadel/state.json`.
   *
   * @param cwd - The project's directory.
   * @returns The manifest, or `undefined` when it is missing or malformed,
   *   which sends the doctor's managed-files check into its template-derived
   *   fallback.
   */
  static readManifest(cwd: string): Promise<ScaffoldManifest | undefined> {
    return new ScaffoldManifestFile(cwd).read();
  }

  /**
   * Records which managed app files `setup` wrote, with each one's hash and
   * ownership class, in `.zitadel/state.json`.
   *
   * @param options - What setup wrote, and where.
   */
  static writeManifest(
    options: { cwd: string } & Parameters<ScaffoldManifestFile["write"]>[0],
  ): Promise<void> {
    return new ScaffoldManifestFile(options.cwd).write(options);
  }

  private readonly detectors: ReadonlyArray<Detector>;
  private readonly scaffolders: ReadonlyArray<Scaffolder>;
  private readonly patchers: ReadonlyArray<Patcher>;
  private readonly localDirectory: string;

  /**
   * @param detectors - The strategies that recognise an existing project.
   * @param scaffolders - The strategies that create a project.
   * @param patchers - The strategies that integrate Zitadel.
   * @param localDirectory - The folder, relative to a project, where a started
   *   local server keeps its state (`.zitadel/runtime`). A scaffold treats it as
   *   not being in the way.
   */
  constructor(
    detectors: ReadonlyArray<Detector>,
    scaffolders: ReadonlyArray<Scaffolder>,
    patchers: ReadonlyArray<Patcher>,
    localDirectory: string,
  ) {
    this.detectors = detectors;
    this.scaffolders = scaffolders;
    this.patchers = patchers;
    this.localDirectory = localDirectory;
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
      ? this.detectors.filter((detector) => {
          return detector.framework === requested;
        })
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

  /**
   * What stands in the way of scaffolding into `cwd`.
   *
   * @param cwd - The directory to scaffold into.
   * @returns Whether it can be scaffolded, and what it holds.
   */
  inspectScaffoldTarget(cwd: string): Promise<ScaffoldTarget> {
    return inspectScaffoldTarget(cwd, this.localDirectory);
  }

  /** Whether `cwd` is safe for an in-place framework scaffold. */
  async isFreshScaffoldTarget(cwd: string): Promise<boolean> {
    return (await this.inspectScaffoldTarget(cwd)).scaffoldable;
  }

  /**
   * Describes the new `framework` app {@link scaffold} would create in `cwd`,
   * without touching the directory, so a caller can ask its questions first and
   * create the app only once it has every answer. Refuses up front what would
   * stop the app later: a framework no scaffolder can create or no patcher can
   * integrate.
   */
  async planScaffold(cwd: string, framework: string): Promise<PlannedApp> {
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
    const target = await this.inspectScaffoldTarget(cwd);
    if (!target.scaffoldable && !force) {
      throw new ZitadelError("E_CONFLICT", `Cannot scaffold: ${cwd} is not empty`, {
        hint:
          `${target.reason ? `${target.reason} ` : ""}Pass --force to scaffold into a ` +
          "non-empty directory, or run setup from an existing supported app project.",
        details: { entries: target.entries },
      });
    }
    // A directory that does not exist yet is created only now, so a refusal or
    // a dry run leaves no trace of it, and an undo removes it again with any
    // parent it took to create it.
    const created = await mkdir(cwd, { recursive: true });
    const before = await listEntries(cwd);
    const workspace = await openScaffoldWorkspace(cwd, target.entries);
    const undo = () => {
      return created === undefined
        ? undoScaffold(cwd, before, workspace)
        : rm(created, { recursive: true, force: true });
    };
    // Starting from a resolved promise puts the scaffolder lookup, which throws
    // for an unknown framework, under the same undo as the scaffold itself.
    const facts = await Promise.resolve()
      .then(() => {
        return this.scaffolderFor(framework).scaffold(workspace?.work ?? cwd, framework);
      })
      .then(() => {
        return mergeScaffold(cwd, workspace);
      })
      .then(() => {
        return this.detect(cwd, framework);
      })
      .catch(async (error: unknown) => {
        await undo();
        throw error;
      });
    return {
      facts,
      undo,
      keep: () => {
        return dropWorkspace(workspace);
      },
    };
  }

  /**
   * Resolves the scaffolder for a framework, throwing `E_VALIDATION` (with the
   * available list) when none matches.
   */
  scaffolderFor(framework: string): Scaffolder {
    const scaffolder = this.scaffolders.find((candidate) => {
      return candidate.canScaffold(framework);
    });
    if (!scaffolder) {
      throw new ZitadelError("E_VALIDATION", `No scaffolder supports "${framework}"`, {
        hint: `Available frameworks: ${this.availableFrameworks()
          .map((f) => {
            return f.id;
          })
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
    const patcher = this.patchers.find((candidate) => {
      return candidate.canPatch(framework);
    });
    if (!patcher) {
      throw new ZitadelError("E_VALIDATION", `No patcher supports "${framework}"`, {
        hint: "Zitadel integration currently supports Next.js.",
      });
    }
    return patcher;
  }

  /** The frameworks that can be scaffolded, derived from the scaffolder registry. */
  availableFrameworks(): ReadonlyArray<FrameworkChoice> {
    return this.scaffolders.map((scaffolder) => {
      return {
        id: scaffolder.supportedFrameworks[0] ?? scaffolder.displayName,
        displayName: scaffolder.displayName,
      };
    });
  }

  private frameworkIds(): ReadonlyArray<string> {
    return this.detectors.map((detector) => {
      return detector.framework;
    });
  }

  /** A framework's name as people write it ("Next.js" for `next`), or its id when it has none. */
  displayName(id: string): string {
    return (
      this.availableFrameworks().find((framework) => {
        return framework.id === id;
      })?.displayName ?? id
    );
  }

  /** `cwd` holds a `detected` app, and setup was asked to set up a `requested` one. */
  private frameworkMismatch(requested: string, detected: string): ZitadelError {
    const name = (id: string) => {
      return this.displayName(id);
    };
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

/** {@link Orca} wired with the default detector, scaffolder, and patcher registries. */
export function createOrca(localDirectory: string): Orca {
  return new Orca(detectors, scaffolders, patchers, localDirectory);
}

/**
 * What stands in the way of scaffolding a framework into `cwd`.
 *
 * @param cwd - The directory to scaffold into.
 * @param localDirectory - Where a started local server keeps its state, which
 *   does not count as in the way.
 * @returns Whether the directory can be scaffolded, and what it holds.
 */
export async function inspectScaffoldTarget(
  cwd: string,
  localDirectory: string,
): Promise<ScaffoldTarget> {
  // A fresh scaffold needs an empty directory. We deliberately keep no allowlist
  // of other tools' "harmless" entries (`.claude`, editor settings, …): that list
  // is a maintenance treadmill, and each tool invents new metadata. Anything
  // present means not-fresh, and `--force` is the single, explicit override.
  //
  // The one exception is what `zitadel start` itself leaves, so that `start`
  // and then `setup` work in a new directory: the local runtime, and the
  // `.gitignore` line that keeps it out of git. `scaffold()` moves both aside
  // while the generator runs and merges the `.gitignore` back.
  // A scaffold target that does not exist yet has no entries: the scaffold
  // creates it, as a framework's own generator creates `my-app`, so a `--cwd`
  // naming the new app's directory works before that directory does.
  const names = [...(await readDirIfExists(cwd))].sort();
  const others: string[] = [];
  for (const name of names) {
    if (!(await isLocalRuntimeEntry(cwd, name, localDirectory))) {
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
 * Whether a project directory is a directory, or does not exist yet, which a
 * scaffold creates. One that is a file, or lies under one, is not.
 */
export async function isDirectoryOrMissing(cwd: string): Promise<boolean> {
  return stat(cwd).then(
    (stats) => {
      return stats.isDirectory();
    },
    (error: unknown) => {
      if (isErrno(error, "ENOENT")) {
        return true;
      }
      if (isErrno(error, "ENOTDIR")) {
        return false;
      }
      throw error;
    },
  );
}

/**
 * Whether `name` in `cwd` is one of the entries `zitadel start` writes
 * (`ensureLocalState`): a `.zitadel` that holds nothing but the local runtime,
 * or a `.gitignore` that holds nothing but the line ignoring it. Either may be
 * empty once `reset` has removed the runtime.
 */
async function isLocalRuntimeEntry(
  cwd: string,
  name: string,
  localDirectory: string,
): Promise<boolean> {
  try {
    if (name === dirname(localDirectory)) {
      const inside = await readdir(join(cwd, name));
      return inside.every((entry) => {
        return entry === basename(localDirectory);
      });
    }
    if (name === ".gitignore") {
      const lines = (await readFile(join(cwd, name), "utf8")).split(/\r?\n/);
      return lines.every((line) => {
        return ["", `${localDirectory}/`].includes(line.trim());
      });
    }
  } catch {
    // Not a directory, or not a readable file: not what `start` wrote.
  }
  return false;
}

async function openScaffoldWorkspace(
  cwd: string,
  names: ReadonlyArray<string>,
): Promise<ScaffoldWorkspace | undefined> {
  if (names.length === 0) {
    return undefined;
  }
  const dir = join(
    dirname(cwd),
    `.${basename(cwd).slice(0, 100)}.fresh-scaffold-stash-${String(process.pid)}-${String(Date.now())}`,
  );
  const work = join(dir, "work", basename(cwd));
  await mkdir(work, { recursive: true, mode: 0o700 });
  return { dir, work, backup: join(dir, "backup") };
}

/**
 * Moves what the scaffold created into the project. What the project already
 * holds under the same name is backed up first, so an undo can put it back. For
 * `.gitignore`, the backed-up rules are merged in so ignores the existing setup
 * relied on, notably `.zitadel/local/`, which keeps the local admin credential
 * out of git, are not dropped. Any other collision keeps the scaffold's version
 * (that is what `--force` is for).
 */
async function mergeScaffold(cwd: string, workspace: ScaffoldWorkspace | undefined): Promise<void> {
  if (!workspace) {
    return;
  }
  for (const name of await readdir(workspace.work)) {
    const dest = join(cwd, name);
    const replaces = await pathExists(dest);
    if (replaces) {
      await fse.move(dest, join(workspace.backup, name));
    }
    await fse.move(join(workspace.work, name), dest);
    if (replaces && name === ".gitignore") {
      await mergeGitignore(join(workspace.backup, name), dest);
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
 * then moves back what is still in the backup, which the scaffold replaced or
 * a failure kept from coming back.
 */
async function undoScaffold(
  cwd: string,
  before: DirectoryListing,
  workspace: ScaffoldWorkspace | undefined,
): Promise<void> {
  const replaced = new Set(workspace ? await readDirIfExists(workspace.backup) : []);
  for (const entry of await readdir(cwd)) {
    const inside = before.get(entry);
    if (!before.has(entry) || replaced.has(entry)) {
      await rm(join(cwd, entry), { recursive: true, force: true });
    } else if (inside !== undefined) {
      for (const child of await readdir(join(cwd, entry))) {
        if (!inside.has(child)) {
          await rm(join(cwd, entry, child), { recursive: true, force: true });
        }
      }
    }
  }
  if (workspace) {
    for (const name of replaced) {
      await rename(join(workspace.backup, name), join(cwd, name));
    }
  }
  await dropWorkspace(workspace);
}

async function dropWorkspace(workspace: ScaffoldWorkspace | undefined): Promise<void> {
  if (workspace) {
    await rm(workspace.dir, { recursive: true, force: true });
  }
}

/** Append any lines from the replaced `.gitignore` that the scaffold's own one lacks. */
async function mergeGitignore(replaced: string, dest: string): Promise<void> {
  const [from, into] = await Promise.all([readFile(replaced, "utf8"), readFile(dest, "utf8")]);
  const present = new Set(
    into.split("\n").map((line) => {
      return line.trim();
    }),
  );
  const missing = from.split("\n").filter((line) => {
    return line.trim() && !present.has(line.trim());
  });
  if (missing.length === 0) {
    return;
  }
  await writeFile(dest, `${into}${into.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
}
