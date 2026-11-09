import {
  type ClientIdVariable,
  type ClientSecretVariable,
  credentialVariables,
} from "@zitadel/config/idp";

import type { EnvironmentSelector } from "@/lib/suggestion";
import { reportWarning } from "@/lib/warnings";
import type { Connection, Credential } from "@/lib/zitadel";

import {
  type CredentialNames,
  type GivenCredentials,
  publishClientId,
  type PublishedCredentials,
  type PublishState,
  reportClientIdOutcome,
  reportSecretOutcome,
  republishArgs,
  type SecretOutcome,
  type SecretPublisher,
  storeClientSecret,
} from "./credentials";

/**
 * Where {@link CredentialDelivery} publishes, and how it reports.
 */
export type DeliveryRun = {
  /**
   * The connection the credentials belong to: the one created, or the one
   * reused.
   */
  readonly connection: Connection;

  /**
   * Whether the connection was already in the project, so a secret not given
   * reads as kept rather than missing.
   */
  readonly reused: boolean;

  /**
   * The run's `--env`/`--env-file`/`--server`, so a recovery command targets
   * the same project.
   */
  readonly selector: EnvironmentSelector;

  /**
   * The running CLI's version, for the public spelling of a recovery command.
   */
  readonly cliVersion: string;
};

/**
 * Publishes a connection's credentials to the project variables it reads them
 * from, and says how to finish the job for any that did not arrive.
 *
 * @remarks
 * It never calls the server itself: the caller hands it a
 * {@link SecretPublisher}, so this module decides what becomes of a credential
 * without depending on the backend.
 */
export class CredentialDelivery {
  /**
   * Where the credentials go, and how the run reports.
   */
  private readonly run: DeliveryRun;

  /**
   * Hold where the credentials go.
   *
   * @param run - The connection, whether it is reused, and how the run
   *   reports.
   */
  constructor(run: DeliveryRun) {
    this.run = run;
  }

  /**
   * The project variables the connection reads its credentials from.
   *
   * @remarks
   * A connection with no `oidc` block leaves both to the variables its slug
   * derives.
   *
   * @returns The client id's and client secret's variables.
   */
  get names(): CredentialNames {
    const connection = this.run.connection;
    const credentials = connection.credentials;
    if (credentials === undefined) {
      return credentialVariables(connection.slug);
    }
    return {
      clientId: CredentialDelivery.variableOf(credentials.clientId),
      clientSecret: CredentialDelivery.variableOf(credentials.clientSecret),
    };
  }

  /**
   * Store the credentials in the project variables the connection reads them
   * from, the client id first: it is the half the developer can read back
   * afterwards.
   *
   * @remarks
   * A credential the connection holds as a value has no variable to go to,
   * which is said instead.
   *
   * @param given - The credentials.
   * @param publish - Where they go, or `undefined` when there is no project.
   * @returns What became of each credential.
   */
  async publish(
    given: GivenCredentials,
    publish: SecretPublisher | undefined,
  ): Promise<PublishedCredentials> {
    const names = this.names;
    const path = this.run.connection.path;
    if (given.clientId !== undefined && names.clientId === undefined) {
      reportWarning(
        `${path} holds its client id directly, so nothing was published. Edit the file to change it.`,
      );
    }
    if (given.secret !== undefined && names.clientSecret === undefined) {
      reportWarning(
        `${path} holds its client secret directly, so nothing was published. ` +
          "Replace it with a ${{ NAME }} reference so the secret is not committed.",
      );
    }
    const clientId = await this.publishClientId(given, publish);
    const secret = await this.storeSecret(given, publish);
    if (clientId !== undefined && names.clientId !== undefined) {
      reportClientIdOutcome(names.clientId, clientId, this.run.cliVersion, this.run.selector);
    }
    if (secret !== undefined) {
      reportSecretOutcome(secret, this.run.cliVersion, this.run.reused, this.run.selector);
    }
    return { clientId, secret };
  }

  /**
   * Whether both credentials reached the project: the secret stored, and the
   * client id stored or not sent.
   *
   * @param published - What became of each credential.
   * @returns Whether the project holds them.
   */
  areStored(published: PublishedCredentials): boolean {
    if (published.secret?.published !== "stored") {
      return false;
    }
    return published.clientId !== "deferred" && published.clientId !== "failed";
  }

  /**
   * The `variable set` arguments for each credential that did not reach the
   * project: the connection references it as `${{ NAME }}`, so a button whose
   * credential never arrived fails at token exchange.
   *
   * @param published - What became of each credential.
   * @param extraArgs - Appended to every command, such as the run's `--cwd`
   *   and environment.
   * @returns One argument list per credential the project lacks.
   */
  recoveryArgs(
    published: PublishedCredentials,
    extraArgs: readonly string[],
  ): readonly (readonly string[])[] {
    const names = this.names;
    return republishArgs(
      [
        { name: names.clientId, secret: false, published: published.clientId },
        { name: names.clientSecret, secret: true, published: published.secret?.published },
      ],
      extraArgs,
    );
  }

  /**
   * Publish the client id, when there is one and a variable to hold it.
   *
   * @param given - The credentials.
   * @param publish - Where it goes.
   * @returns Whether it reached the project, or `undefined` when nothing was sent.
   */
  private async publishClientId(
    given: GivenCredentials,
    publish: SecretPublisher | undefined,
  ): Promise<PublishState | undefined> {
    const name = this.names.clientId;
    if (given.clientId === undefined || name === undefined) {
      return undefined;
    }
    return publishClientId({ name, value: given.clientId, publish });
  }

  /**
   * Store the client secret, when there is one and a variable to hold it.
   *
   * @param given - The credentials.
   * @param publish - Where it goes.
   * @returns Where it ended up, or `undefined` when nothing was sent.
   */
  private async storeSecret(
    given: GivenCredentials,
    publish: SecretPublisher | undefined,
  ): Promise<SecretOutcome | undefined> {
    const name = this.names.clientSecret;
    if (given.secret === undefined || name === undefined) {
      return undefined;
    }
    return storeClientSecret({ name, value: given.secret, publish });
  }

  /**
   * The variable a credential references.
   *
   * @typeParam Variable - The kind of variable the credential's field references.
   * @param credential - The credential.
   * @returns The variable, or `undefined` when the credential is held as a value.
   */
  private static variableOf<Variable extends ClientIdVariable | ClientSecretVariable>(
    credential: Credential<"client_id" | "client_secret", Variable>,
  ): Variable | undefined {
    if (credential.kind === "literal") {
      return undefined;
    }
    return credential.variable;
  }
}
