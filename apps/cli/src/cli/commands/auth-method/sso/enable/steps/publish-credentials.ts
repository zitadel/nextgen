import { VariableService, VariableWrite } from "@/lib/backend";
import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"remote" | "delivery" | "given">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "source">;

/**
 * Stores the credentials in the project's variables, where the engine resolves
 * a connection's `${{ NAME }}` references from.
 *
 * @remarks
 * They go before the files are written, and nothing takes them back: published
 * first, a failed write leaves nothing behind but credentials the rerun asks for
 * and stores again.
 */
export class PublishCredentials extends WizardStep<"publish", Fact<"published">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
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
  async run(needs: Needs): Promise<Fact<"published">> {
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
