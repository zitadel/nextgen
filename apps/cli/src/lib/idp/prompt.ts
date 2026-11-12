import {
  type ClientId,
  type ClientSecretVariable,
  type ConnectionEndpoints,
  type ProviderSelection,
  parseClientId,
  parseClientSecret,
  providerOf,
  selectionName,
} from "@zitadel/config/idp";

import { inShell, type Suggest, type SuggestedCommand } from "@/lib/suggestion";
import type { Questions } from "@/lib/ui";

import type { GivenCredentials } from "./credentials";
import { askConnectionEndpoints } from "./endpoints";

/**
 * What a suggested retry names where the client id is still to be given: the
 * one value there that is not a client id, so it is the reader's to replace.
 */
const CLIENT_ID_PLACEHOLDER = "<client-id>" as ClientId;

/**
 * What {@link CredentialPrompt} asks about, and how.
 */
export type PromptRun = {
  /**
   * The provider the connection signs in with.
   */
  readonly selection: ProviderSelection;

  /**
   * Whether the connection was already in the project.
   */
  readonly reused: boolean;

  /**
   * The variable the client secret is stored in, which the question names.
   */
  readonly secretVariable: ClientSecretVariable | undefined;

  /**
   * How a question is asked: the running command's `this.ask`.
   */
  readonly ask: Questions;

  /**
   * Whether this is a development build that may ask where the provider
   * answers.
   */
  readonly developmentBuild: boolean;

  /**
   * Renders a suggested retry for the run, scope included, so it targets the
   * same project.
   */
  readonly suggest: Suggest;
};

/**
 * Asks for the client id and secret of the application registered with a
 * provider, once nothing is left that could refuse the run.
 *
 * @remarks
 * The secret never comes from a flag: it is asked for, or read from stdin when
 * scripting, so it cannot land in shell history, a process listing, or CI
 * logs.
 */
export class CredentialPrompt {
  /**
   * What the questions are about, and how they are asked.
   */
  private readonly run: PromptRun;

  /**
   * Hold what the questions are about.
   *
   * @param run - The provider, whether the connection is reused, the secret's
   *   variable, and how the run asks.
   */
  constructor(run: PromptRun) {
    this.run = run;
  }

  /**
   * Ask for the credentials the connection needs.
   *
   * @remarks
   * A new connection needs both: a sign-in button without them fails at the
   * provider, in a browser, not here. A reused one is given only what the
   * developer passes: the project may already hold its credentials, and an
   * unattended rerun should not start asking for them.
   *
   * @param givenClientId - The client id `--client-id` gave, if any.
   * @returns The credentials, and the endpoints a development run answered.
   */
  async ask(givenClientId: ClientId | undefined): Promise<GivenCredentials> {
    const provider = providerOf(this.run.selection);
    if (this.run.reused) {
      // Only read so that a rerun can replace a secret the project holds.
      const secret = await this.run.ask.secret({
        name: "client secret",
        message: `What is the client secret of your ${provider.displayName} OAuth app?`,
        parse: parseClientSecret,
        stdin: true,
        optional: true,
      });

      return {
        endpoints: undefined,
        clientId: givenClientId,
        secret,
      };
    }
    // Before the credentials: on a development run (ZITADEL_CLI_DEV) the
    // provider may be a local stand-in, and the client is registered with
    // whatever answers. Not asked of a custom connection, whose issuer the
    // developer has already given.
    const endpoints = await this.askEndpoints();
    const clientId = await this.run.ask.text({
      name: `client id for ${provider.displayName}`,
      message: `What is the client ID of your ${provider.displayName} OAuth app?`,
      flag: "--client-id",
      parse: parseClientId,
      given: givenClientId,
      retry: this.retryFor(CLIENT_ID_PLACEHOLDER, ""),
    });
    const secretVariable = this.run.secretVariable;
    const secret = await this.run.ask.secret({
      name: `client secret for ${secretVariable}`,
      message: `What is the client secret of your ${provider.displayName} OAuth app? It will be stored on the project as ${secretVariable}.`,
      parse: parseClientSecret,
      stdin: true,
      retry: this.retryFor(clientId, `printf '%s' "$CLIENT_SECRET" | `),
    });

    return {
      endpoints,
      clientId,
      secret,
    };
  }

  /**
   * Where a catalog provider lives, on a development run only.
   *
   * @returns The endpoints, or `undefined` for a custom provider or a normal run.
   */
  private async askEndpoints(): Promise<ConnectionEndpoints | undefined> {
    const selection = this.run.selection;
    if (selection.kind !== "catalog") {
      return undefined;
    }

    return askConnectionEndpoints({
      provider: selection.id,
      developmentBuild: this.run.developmentBuild,
      ask: this.run.ask,
    });
  }

  /**
   * What an agent can run once a missing credential is to hand. Only for a
   * catalog provider: a custom connection needs its settings repeated too.
   *
   * @param clientId - The client id, or a placeholder for it.
   * @param pipe - What feeds the secret on stdin, if anything.
   * @returns The command, or `undefined` for a custom provider.
   */
  private retryFor(clientId: ClientId, pipe: string): SuggestedCommand | undefined {
    const selection = this.run.selection;
    if (selection.kind !== "catalog") {
      return undefined;
    }
    const command = this.run.suggest("auth-method:sso:enable", {
      flags: {
        provider: selectionName(selection),
        clientId,
      },
    });

    return inShell(command, { before: pipe });
  }
}
