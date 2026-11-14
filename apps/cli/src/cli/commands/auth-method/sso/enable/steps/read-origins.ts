import { isCancelled, Origins, OriginService } from "@/lib/backend";
import type { Connection as RemoteConnection } from "@/lib/oclif/types";
import { WizardStep } from "@/lib/wizard";

import type { EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the run learned about the project it addresses.
 */
type Remote = Readonly<{
  /**
   * The connection to the project and server.
   */
  remote: RemoteConnection;

  /**
   * The origins the project serves, which name more callback URIs.
   */
  origins: Origins;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "connect">;

/**
 * Resolves the project and server before anything else is asked for: being
 * turned away after typing a secret would mean typing it again.
 */
export class ReadOrigins extends WizardStep<"remote", Remote, object> {
  readonly key = "remote";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

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
   * @param this.deps - What the command provides.
   * @returns The connection and the origins.
   */
  async run(_needs: object): Promise<Remote> {
    const remote = await this.deps.connect();
    const origins = await new OriginService(remote.client, remote.projectId)
      .list()
      .catch((cause: unknown) => {
        if (isCancelled(remote.client)) {
          throw cause;
        }
        return Origins.wrap([]);
      });
    return {
      remote,
      origins,
    };
  }
}
