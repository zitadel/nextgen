import { ZitadelError } from "../errors";
import type { Patcher } from "./patchers/types";
import type { Scaffolder } from "./scaffolders/types";

/**
 * One framework the CLI can scaffold from scratch, surfaced to the picker. */
export type FrameworkChoice = Readonly<{ id: string; displayName: string }>;

/**
 * Orchestrates project creation (scaffolders) and Zitadel integration
 * (patchers) over their respective registries. Selection only: it resolves the
 * right scaffolder/patcher for a framework and the caller invokes its methods.
 * How a patcher applies its work (file operations vs an LLM agent) is internal
 * to that patcher, so the orchestrator stays strategy-agnostic. Registries are
 * injected so tests can supply fakes.
 */
export class Orca {
  constructor(
    private readonly scaffolders: ReadonlyArray<Scaffolder>,
    private readonly patchers: ReadonlyArray<Patcher>,
  ) {}

  /**
   * Resolves the scaffolder for a framework, throwing `E_VALIDATION` (with the
   * available list) when none matches.
   */
  scaffolderFor(framework: string): Scaffolder {
    const scaffolder = this.scaffolders.find((candidate) => candidate.canScaffold(framework));
    if (!scaffolder) {
      throw new ZitadelError("E_VALIDATION", `No scaffolder supports "${framework}"`, {
        hint: `Available frameworks: ${this.availableFrameworks().map((f) => f.id).join(", ")}.`,
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
}
