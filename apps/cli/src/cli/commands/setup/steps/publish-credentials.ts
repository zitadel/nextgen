import { type ConnectionSlug, credentialVariables, providerOf } from "@zitadel/config/idp";

import type { Fact, SetupServices, SsoAnswer } from "@/cli/commands/setup/shared";
import { createZitadelClient, VariableService, VariableWrite } from "@/lib/backend";
import {
  type CredentialVariable,
  publishClientId,
  type PublishState,
  type SecretOutcome,
  type SecretPublisher,
  storeClientSecret,
} from "@/lib/idp";
import { log } from "@/lib/log";
import type { SuggestedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { userAgent } from "@/lib/user-agent";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "dryRun" | "signal" | "suggest">;

/**
 * Stores each provider's client id and secret in the project's variables.
 *
 * @remarks
 * After the connection file is written, not before: a credential published
 * under a name nothing references yet is an orphan in the project's variables,
 * and a setup that fails in between would leave one behind. And before the first
 * deploy, which carries the connection and resolves its `${{ NAME }}` from the
 * variables the project holds by then. Neither credential reaches the
 * filesystem. A refusal is reported rather than failing setup: everything else
 * is already written, and `variable set` publishes it later. One outcome per
 * provider, keyed by slug, because one provider's publish can land while
 * another's does not.
 */
export class PublishCredentials extends WizardStep<
  "publishCredentials",
  Fact<"ssoOutcomes">,
  Needs
> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "publishCredentials";

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
   * Publish the credentials of every provider.
   *
   * @remarks
   * The drafts become answers here: the wizard asks for whatever a flag left out, and a scripted
   * run refuses before this point without the client id or the secret on stdin, so a draft that
   * reaches here without one is a bug in setup and not something to ask the developer about.
   *
   * The credentials reach the project through its variables, and there is none when there is no
   * project behind the run: `--server mock` answers from fixtures and has no variables to write.
   * The freshly minted project credentials are used directly: setup has them in hand and nothing
   * has been claimed yet, so there is no owner for the developer to name.
   *
   * @param needs - The answers and the project.
   * @returns What became of each provider's credentials.
   * @throws {Error} When a provider reaches here without the credentials the wizard collects.
   */
  async run(needs: Needs): Promise<Fact<"ssoOutcomes">> {
    const { answers, project } = needs;
    if (answers.sso.length === 0 || this.deps.dryRun) {
      return {
        ssoOutcomes: new Map(),
      };
    }
    const variables =
      answers.server === "mock"
        ? undefined
        : new VariableService(
            createZitadelClient({
              userAgent: userAgent(),
              baseUrl: answers.server,
              token: project.project_secret,
              signal: this.deps.signal,
            }),
            project.id,
          );
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
    return {
      ssoOutcomes: new Map(
        await this.publishEach(
          answers.sso.map((draft) => {
            const { clientId, secret } = draft.credentials;
            if (clientId === undefined || secret === undefined) {
              throw new Error(
                `no credentials were collected for ${providerOf(draft.selection).slug}`,
              );
            }
            return {
              ...draft,
              credentials: {
                clientId,
                secret,
              },
            };
          }),
          publish,
        ),
      ),
    };
  }

  /**
   * Publish the credentials of each provider in turn, and say what became of them.
   *
   * @remarks
   * Only here do both credentials have to exist, and the type says so.
   *
   * A publish that failed because of Ctrl-C reads as a refusal below, so the cancellation is
   * raised before reporting instead of being reported as one.
   *
   * A connection pointing somewhere other than the vendor is said out loud: it is not what the
   * developer will want in the end, and nothing else in the summary would show it.
   *
   * The wizard refuses an empty secret, so a deferred publish here only ever means there was no
   * project to publish to.
   *
   * @param answers - The providers still to publish.
   * @param publish - How the credentials reach the project.
   * @returns What became of each provider's credentials, by slug.
   */
  private async publishEach(
    answers: ReadonlyArray<SsoAnswer>,
    publish: SecretPublisher | undefined,
  ): Promise<
    ReadonlyArray<
      readonly [ConnectionSlug, Readonly<{ clientId: PublishState; secret: SecretOutcome }>]
    >
  > {
    const [answer, ...rest] = answers;
    if (answer === undefined) {
      return [];
    }
    const slug = providerOf(answer.selection).slug;
    const { clientId: idVariable, clientSecret: variable } = credentialVariables(slug);
    const clientId = await publishClientId({
      name: idVariable,
      value: answer.credentials.clientId,
      publish,
    });
    const secret = await storeClientSecret({
      name: variable,
      value: answer.credentials.secret,
      publish,
    });
    this.deps.signal.throwIfAborted();
    if (answer.endpoints?.issuer !== undefined) {
      reportWarning(
        `${providerOf(answer.selection).displayName} points at ` +
          `${answer.endpoints.issuer}, not the provider`,
      );
    }
    this.reportPublished(
      idVariable,
      clientId,
      this.deps.suggest({ id: "variable:set", args: { name: idVariable } }),
    );
    this.reportPublished(
      secret.name,
      secret.published,
      this.deps.suggest({
        id: "variable:set",
        args: { name: secret.name },
        flags: { secret: true },
      }),
    );
    return [
      [
        slug,
        {
          clientId,
          secret,
        },
      ],
      ...(await this.publishEach(rest, publish)),
    ];
  }

  /**
   * Say whether the project received a credential, and how to retry when it did
   * not.
   *
   * @remarks
   * The wizard refuses an empty secret, so a deferred publish only ever means
   * there was no project to publish to, and never that no value was given.
   *
   * @param name - The variable.
   * @param state - What became of it.
   * @param republish - The command that publishes it.
   */
  private reportPublished(
    name: CredentialVariable,
    state: PublishState,
    republish: SuggestedCommand,
  ): void {
    switch (state) {
      case "stored": {
        log.done(`Published ${escapeControlCharacters(name)} to the project`);
        return;
      }
      case "deferred": {
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
