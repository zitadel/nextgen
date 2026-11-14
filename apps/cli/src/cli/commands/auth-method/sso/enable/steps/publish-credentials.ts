import { VariableService, VariableWrite, type ZitadelClient } from "@/lib/backend";
import type {
  SecretPublisher,
  CredentialDelivery,
  GivenCredentials,
  PublishedCredentials,
} from "@/lib/idp";

import type { Connection as RemoteConnection } from "@/lib/oclif/types";
import { WizardStep } from "@/lib/wizard";

import type { EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  remote: RemoteConnection;
  delivery: CredentialDelivery;
  given: GivenCredentials;
}>;

/**
 * Stores the credentials in the project's variables, where the engine resolves
 * a connection's `${{ NAME }}` references from.
 *
 * @remarks
 * They go before the files are written, and nothing takes them back: published
 * first, a failed write leaves nothing behind but credentials the rerun asks for
 * and stores again.
 */
export class PublishCredentials extends WizardStep<
  "publish",
  Readonly<{ published: PublishedCredentials }>,
  Needs,
  EnableServices
> {
  readonly key = "publish";

  /**
   * Publish what was given.
   *
   * @param needs - The delivery, the credentials and the project.
   * @param services - What the command provides.
   * @returns What became of each credential.
   */
  async run(
    needs: Needs,
    services: EnableServices,
  ): Promise<Readonly<{ published: PublishedCredentials }>> {
    return {
      published: await needs.delivery.publish(
        needs.given,
        this.publisher(services, needs.remote.client, needs.remote.projectId),
      ),
    };
  }

  /**
   * How the connection's credentials reach the project.
   *
   * @remarks
   * It writes to the project's own variables, which is where the engine
   * resolves a connection's `${{ NAME }}` references from.
   *
   * @param client - The client every call goes through.
   * @param projectId - The project.
   * @returns The publisher, or `undefined` when there is no project behind this
   *   run: `--source mock` answers from fixtures and has no variables to write.
   */
  private publisher(
    services: EnableServices,
    client: ZitadelClient,
    projectId: string,
  ): SecretPublisher | undefined {
    if (services.source === "mock") {
      return undefined;
    }
    const variableService = new VariableService(client, projectId);
    return async (name, value, options) => {
      const write = VariableWrite.of({
        secret: options.secret,
        preview: false,
      });
      await variableService.set(name, value, write);
    };
  }
}
