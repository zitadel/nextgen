import { Publisher } from "@/lib/publish";
import { warnings } from "@/lib/ui";

import type { InitialDeployment, InitialReleaseInput } from "./types";

/**
 * The first release of a project nothing has been deployed to.
 *
 * Temporary: `setup` and `env add` offer this deploy until a project is
 * created with its first release, and both go with it.
 */
export class InitialRelease {
  /** What to publish, to whom, and how the run reports. */
  readonly input: InitialReleaseInput;

  private constructor(input: InitialReleaseInput) {
    this.input = input;
  }

  /**
   * The first release of a project, ready to publish.
   *
   * @param input - The project, the directory and how the run reports.
   * @returns The release.
   */
  static of(input: InitialReleaseInput): InitialRelease {
    return new InitialRelease(input);
  }

  /**
   * Publish `.zitadel/` to a project nothing has been deployed to, the way
   * `deploy` does: build the bundle, validate it, create the release and
   * deploy it to every primary origin. `deploy`'s diff step is left out,
   * because there is no live release to diff against, and so is its
   * optimistic guard, because there is no deployment to race with.
   *
   * @returns What was published.
   * @throws When the bundle does not validate or the platform refuses it.
   */
  async deploy(): Promise<InitialDeployment> {
    const input = this.input;
    const publisher = new Publisher(input.client, input.projectId);
    const prepared = await publisher.prepare({
      cwd: input.cwd,
      env: input.env,
      mode: "deploy",
      dryRun: false,
      compare: false,
      json: input.json,
      color: input.color,
    });
    for (const warning of prepared.warnings) {
      warnings.report(warning);
    }
    input.narrate(prepared.notices);
    const { release, deployment } = await publisher.deployInitial({
      prepared,
      message: input.message,
    });
    return {
      releaseId: release.id,
      contentHash: release.content_hash,
      deploymentId: deployment.id,
      origins: deployment.targets.map((target) => {
        return target.origin;
      }),
    };
  }
}
