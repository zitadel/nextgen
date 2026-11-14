import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { VariableService, VariableWrite } from "@/lib/backend";
import {
  type CredentialVariable,
  type PublishState,
  publishClientId,
  type SecretPublisher,
  storeClientSecret,
} from "@/lib/idp";
import { log } from "@/lib/log";
import type { SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"remote" | "names" | "given" | "summary">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "signal" | "source" | "suggest">;

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
   * Publish what was given, and say what became of each credential.
   *
   * @remarks
   * Stored client id first: it is the half the developer can read back
   * afterwards. A client id the connection holds as a value has no variable to
   * go to, which is said instead. A client secret held as a value never reaches
   * here: `auth-method` refuses it first.
   *
   * A Ctrl-C during a write comes back as a failed outcome, not as an error, so the
   * signal is checked once the credentials are published and the run stops there instead of
   * writing the files.
   *
   * The credentials reach the project through its own variables, which is where
   * the engine resolves a connection's `${{ NAME }}` references from. There is
   * no publisher when there is no project behind the run: `--source mock`
   * answers from fixtures and has no variables to write. A refusal is reported
   * rather than raised: the files are still written, and one later `variable set`
   * publishes what the project lacks. A deferral reads as "no value yet" only for a reused
   * connection, which was given no secret; for a new one it means there was no project.
   *
   * @param needs - The variables, the credentials, the project and the summary.
   * @returns What became of each credential.
   */
  async run(needs: Needs): Promise<Fact<"published">> {
    const variables =
      this.deps.source === "mock"
        ? undefined
        : new VariableService(needs.remote.client, needs.remote.projectId);
    const publish: SecretPublisher | undefined =
      variables === undefined
        ? undefined
        : async (name, value, options) => {
            try {
              await variables.set(
                name,
                value,
                VariableWrite.of({
                  secret: options.secret,
                  preview: false,
                }),
              );
            } catch (error) {
              log.debug(`Publishing ${name} to the project failed`, error);
              throw error;
            }
          };
    const { clientId: idVariable, clientSecret: secretVariable } = needs.names;
    if (needs.given.clientId !== undefined && idVariable === undefined) {
      reportWarning(
        `${needs.summary.connection.path} holds its client id directly, so nothing was published. Edit the file to change it.`,
      );
    }
    const clientId =
      needs.given.clientId === undefined || idVariable === undefined
        ? undefined
        : await publishClientId({
            name: idVariable,
            value: needs.given.clientId,
            publish,
          });
    const secret =
      needs.given.secret === undefined || secretVariable === undefined
        ? undefined
        : await storeClientSecret({
            name: secretVariable,
            value: needs.given.secret,
            publish,
          });
    if (clientId !== undefined && idVariable !== undefined) {
      this.reportPublished(
        idVariable,
        clientId,
        this.deps.suggest({ id: "variable:set", args: { name: idVariable } }),
        false,
      );
    }
    if (secret !== undefined) {
      this.reportPublished(
        secret.name,
        secret.published,
        this.deps.suggest({
          id: "variable:set",
          args: { name: secret.name },
          flags: { secret: true },
        }),
        needs.summary.reused,
      );
    }
    this.deps.signal.throwIfAborted();
    return {
      published: {
        clientId,
        secret,
      },
    };
  }

  /**
   * Say whether the project received a credential, and how to retry when it did
   * not.
   *
   * @remarks
   * `noValue` separates the two ways a publish can be deferred: nothing was
   * supplied, or there was no project to publish to. They read the same to the
   * code and call for different things from the developer. A missing client id
   * is never "no value yet": the command refuses without one, so the only way
   * here is a project it could not reach.
   *
   * @param name - The variable.
   * @param state - What became of it.
   * @param republish - The command that publishes it.
   * @param noValue - Whether a deferral means no value was given.
   */
  private reportPublished(
    name: CredentialVariable,
    state: PublishState,
    republish: SuggestedCommand,
    noValue: boolean,
  ): void {
    switch (state) {
      case "stored": {
        log.done(`Published ${escapeControlCharacters(name)} to the project`);
        return;
      }
      case "deferred": {
        if (noValue) {
          reportWarning(`${name} has no value yet. Publish it with: ${republish}`);
          return;
        }
        reportWarning(`${name} was not published to the project. Publish it with: ${republish}`);
        return;
      }
      case "failed": {
        reportWarning(`${name} could not be published. Sign-in fails until it is: ${republish}`);
        return;
      }
    }
  }
}
