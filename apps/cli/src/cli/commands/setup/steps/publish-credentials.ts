import {
  type CreatedProject,
  createZitadelClient,
  VariableService,
  VariableWrite,
} from "@/lib/backend";
import type { SecretPublisher } from "@/lib/idp";
import { userAgent } from "@/lib/user-agent";

import { type ConnectionSlug, credentialVariables, providerOf } from "@zitadel/config/idp";

import {
  type PublishState,
  publishClientId,
  reportClientIdOutcome,
  reportSecretOutcome,
  type SecretOutcome,
  storeClientSecret,
} from "@/lib/idp";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SsoAnswer, SsoDraft, SetupServices } from "@/cli/commands/setup/shared";

/**
 * The drafts as answers, for a run that goes on to publish credentials.
 *
 * The wizard asks for whatever a flag left out, and a scripted run refuses
 * before this point without the client id or the secret on stdin, so a draft
 * that reaches here without one is a bug in setup and not something to ask
 * the developer about.
 */
function completeSso(drafts: readonly SsoDraft[]): SsoAnswer[] {
  return drafts.map((draft) => {
    const { clientId, secret } = draft.credentials;
    if (clientId === undefined || secret === undefined) {
      throw new Error(`no credentials were collected for ${providerOf(draft.selection).slug}`);
    }
    return {
      ...draft,
      credentials: {
        clientId,
        secret,
      },
    };
  });
}

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers" | "project">;

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
  Needs,
  SetupServices
> {
  readonly key = "publishCredentials";

  /**
   * Publish the credentials of every provider.
   *
   * @param needs - The answers and the project.
   * @param services - What the command provides.
   * @returns What became of each provider's credentials.
   */
  async run(needs: Needs, services: SetupServices): Promise<Fact<"ssoOutcomes">> {
    const { answers, project } = needs;
    if (answers.sso.length === 0 || services.dryRun) {
      return {
        ssoOutcomes: new Map(),
      };
    }
    return {
      ssoOutcomes: new Map(
        await this.publishEach(
          completeSso(answers.sso),
          ssoCredentialPublisher(answers.server, project, services.signal),
          services,
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
   * @param answers - The providers still to publish.
   * @param publish - How the credentials reach the project.
   * @param services - What the command provides.
   * @returns What became of each provider's credentials, by slug.
   */
  private async publishEach(
    answers: readonly SsoAnswer[],
    publish: ReturnType<typeof ssoCredentialPublisher>,
    services: SetupServices,
  ): Promise<
    ReadonlyArray<readonly [ConnectionSlug, { clientId: PublishState; secret: SecretOutcome }]>
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
    // A publish that failed because of Ctrl-C reads as a refusal below, so
    // the cancellation is raised here instead of being reported as one.
    services.signal.throwIfAborted();
    if (answer.endpoints?.issuer !== undefined) {
      // Said out loud: a connection pointing somewhere other than the
      // vendor is not what the developer will want in the end, and nothing
      // else in the summary would show it.
      reportWarning(
        `${providerOf(answer.selection).displayName} points at ` +
          `${answer.endpoints.issuer}, not the provider`,
      );
    }
    reportClientIdOutcome(idVariable, clientId, services.suggest);
    // The wizard refuses an empty secret, so a deferred publish here only
    // ever means there was no project to publish to.
    reportSecretOutcome(secret, false, services.suggest);
    return [
      [
        slug,
        {
          clientId,
          secret,
        },
      ],
      ...(await this.publishEach(rest, publish, services)),
    ];
  }
}

/**
 * How the connection's credentials reach the project just created.
 *
 * `undefined` when there is no project behind the run — `--server mock`
 * answers from fixtures and has no variables to write. The freshly minted
 * project credentials are used directly: setup has them in hand and nothing
 * has been claimed yet, so there is no owner for the developer to name.
 */
function ssoCredentialPublisher(
  server: string,
  project: CreatedProject,
  signal: AbortSignal,
): SecretPublisher | undefined {
  if (server === "mock") {
    return undefined;
  }
  const client = createZitadelClient({
    userAgent: userAgent(),
    baseUrl: server,
    token: project.project_secret,
    signal,
  });
  const variableService = new VariableService(client, project.id);
  return async (name, value, { secret }) => {
    await variableService.set(
      name,
      value,
      VariableWrite.of({
        secret,
        preview: false,
      }),
    );
  };
}
