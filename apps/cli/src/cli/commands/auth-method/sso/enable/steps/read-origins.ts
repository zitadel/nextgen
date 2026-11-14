import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { isCancelled, Origins, OriginService } from "@/lib/backend";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "connect">;

/**
 * Resolves the project and server before anything else is asked for: being
 * turned away after typing a secret would mean typing it again.
 */
export class ReadOrigins extends WizardStep<"remote", Fact<"remote" | "origins">, object> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "remote";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Connect, and list the origins.
   *
   * @remarks
   * The origins are read only to name more callback URIs: a platform that cannot
   * answer still gets the local one, and the run goes on. A cancelled run stops
   * instead, as `OriginService.remove` does.
   *
   * @param _needs - Nothing from earlier steps.
   * @returns The connection and the origins.
   */
  async run(_needs: object): Promise<Fact<"remote" | "origins">> {
    const remote = await this.deps.connect();
    return {
      remote,
      origins: await new OriginService(remote.client, remote.projectId)
        .list()
        .catch((cause: unknown) => {
          if (isCancelled(remote.client)) {
            throw cause;
          }
          return Origins.wrap([]);
        }),
    };
  }
}
