import { VariableService, VariableWrite } from "@/lib/backend";
import type { CredentialDelivery, GivenCredentials, PublishedCredentials } from "@/lib/idp";
import type { Connection as RemoteConnection } from "@/lib/oclif/types";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  remote: RemoteConnection;
  delivery: CredentialDelivery;
  given: GivenCredentials;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * The server the run addresses.
   */
  source: string;
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
  Needs
> {
  readonly key = "publish";

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
   * Publish what was given.
   *
   * @remarks
   * The credentials reach the project through its own variables, which is where
   * the engine resolves a connection's `${{ NAME }}` references from. There is
   * no publisher when there is no project behind the run: `--source mock`
   * answers from fixtures and has no variables to write.
   *
   * @param needs - The delivery, the credentials and the project.
   * @returns What became of each credential.
   */
  async run(needs: Needs): Promise<Readonly<{ published: PublishedCredentials }>> {
    const variableService =
      this.deps.source === "mock"
        ? undefined
        : new VariableService(needs.remote.client, needs.remote.projectId);
    return {
      published: await needs.delivery.publish(
        needs.given,
        variableService === undefined
          ? undefined
          : async (name, value, options) => {
              await variableService.set(
                name,
                value,
                VariableWrite.of({
                  secret: options.secret,
                  preview: false,
                }),
              );
            },
      ),
    };
  }
}
