import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

  /**
   * Whether `cwd` has no `package.json`, i.e. it is empty (or non-Node) and
   * should be scaffolded from scratch rather than detected/patched.
   */
  async isEmpty(cwd: string): Promise<boolean> {
    try {
      await readFile(join(cwd, "package.json"), "utf8");
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Creates a new `framework` project in `cwd`, then re-detects it to return
   * the resulting {@link FrameworkFacts}. Throws `E_CONFLICT` when the directory
   * already contains a project ("already scaffolded") and `E_VALIDATION` when no
   * scaffolder supports the framework.
   */
  async scaffold(cwd: string, framework: string): Promise<FrameworkFacts> {
    if (!(await this.isEmpty(cwd))) {
      throw new ZitadelError("E_CONFLICT", `Cannot scaffold: ${cwd} already contains a project`, {
        hint: "Run setup in an empty directory, or integrate the existing project instead.",
      });
    }
    await this.scaffolderFor(framework).scaffold(cwd, framework);
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

/** {@link Orca} wired with the default detector, scaffolder, and patcher registries. */
export function createOrca(): Orca {
  return new Orca(detectors, scaffolders, patchers);
}
