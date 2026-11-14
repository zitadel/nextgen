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
 * Resolves the project and server before anything else is asked for: being
 * turned away after typing a secret would mean typing it again.
 */
export class ReadOrigins extends WizardStep<"remote", Remote, object, EnableServices> {
  readonly key = "remote";

  /**
   * Connect, and list the origins.
   *
   * @remarks
   * The origins are read only to name more callback URIs: a platform that cannot
   * answer still gets the local one, and the run goes on. A cancelled run stops
   * instead, as `OriginService.remove` does.
   *
   * @param _needs - Nothing from earlier steps.
   * @param services - What the command provides.
   * @returns The connection and the origins.
   */
  async run(_needs: object, services: EnableServices): Promise<Remote> {
    const remote = await services.connect();
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
