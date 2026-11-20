import type {
  ClientId,
  ClientIdVariable,
  ClientSecret,
  ClientSecretVariable,
  ConnectionEndpoints,
} from "@zitadel/config/idp";

/**
 * The project variable a connection reads one of its credentials from.
 */
export type CredentialVariable = ClientIdVariable | ClientSecretVariable;

/**
 * A credential's value, as it is published to its variable.
 */
export type CredentialValue = ClientId | ClientSecret;

/**
 * Publishes one variable to the project.
 *
 * @remarks
 * Injected rather than built here: this module decides what becomes of a
 * captured credential, and giving it an API client as well would tie that
 * decision to the whole platform surface. Both callers already hold a
 * connection to the project they just addressed.
 */
export type SecretPublisher = (
  name: CredentialVariable,
  value: CredentialValue,
  options: { readonly secret: boolean },
) => Promise<void>;

/**
 * Every way a publish can end.
 */
export const PUBLISH_STATES = ["stored", "deferred", "failed"] as const;

/**
 * Whether a value reached the project's variables.
 */
export type PublishState = (typeof PUBLISH_STATES)[number];

/**
 * Where a captured client secret ended up, for the command's summary.
 */
export type SecretOutcome = {
  readonly name: ClientSecretVariable;

  /**
   * The project's variables — the only place a credential is written. The
   * connection document references it as `${{ NAME }}` and the engine resolves
   * that from the project's variables and from nowhere else, so a local server
   * and Zitadel Cloud both need the value here.
   *
   * `deferred` when there was no value to publish or no project to publish to;
   * `failed` when the platform refused the call. Neither is fatal — the
   * connection is written either way and `variable set` publishes it later.
   */
  readonly published: PublishState;
};

/**
 * What {@link storeClientSecret} publishes, and where.
 */
export type SecretToStore = {
  readonly name: ClientSecretVariable;
  readonly value?: ClientSecret;
  readonly publish?: SecretPublisher;
};

/**
 * What {@link publishClientId} publishes, and where.
 */
export type ClientIdToPublish = {
  readonly name: ClientIdVariable;
  readonly value: ClientId;
  readonly publish?: SecretPublisher;
};

/**
 * Publish a client secret to the project.
 *
 * @remarks
 * Nothing is written to disk. The value is a credential, the project stores it
 * encrypted under the project's own key (ADR 029), and no runtime reads it
 * from the environment — the token exchange happens on the server. A copy in
 * `.env.local` would be a credential sitting in the working tree for the
 * convenience of nobody, and one `git add -A` away from being published.
 *
 * Passing no value publishes nothing and is not an error: the developer may
 * intend to publish it themselves.
 *
 * @param secret - The variable, the value if there is one, and the publisher.
 * @returns Where the secret ended up.
 */
export async function storeClientSecret(secret: SecretToStore): Promise<SecretOutcome> {
  if (secret.value === undefined) {
    return {
      name: secret.name,
      published: "deferred",
    };
  }
  const published = await publishSecret(secret.publish, secret.name, secret.value, true);

  return {
    name: secret.name,
    published,
  };
}

/**
 * Publish the connection's client id.
 *
 * @remarks
 * An ordinary variable, not a secret: the id travels in the browser's
 * authorize URL, so it is public by construction and hiding it would only cost
 * the developer the ability to read back what was configured.
 *
 * @param clientId - The variable, the value and the publisher.
 * @returns Whether the id reached the project.
 */
export async function publishClientId(clientId: ClientIdToPublish): Promise<PublishState> {
  return publishSecret(clientId.publish, clientId.name, clientId.value, false);
}

/**
 * Send the value to the project, reporting a refusal instead of raising it.
 *
 * @remarks
 * Callers publish before they write the connection document. Failing the
 * command here would abandon the run over something one later command fixes,
 * so the caller warns and points at `variable set`.
 *
 * @param publish - Where the value goes, or `undefined` when there is no project.
 * @param name - The variable.
 * @param value - The value.
 * @param secret - Whether the variable is a secret one.
 * @returns Whether the value reached the project.
 */
async function publishSecret(
  publish: SecretPublisher | undefined,
  name: CredentialVariable,
  value: CredentialValue,
  secret: boolean,
): Promise<PublishState> {
  if (publish === undefined) {
    return "deferred";
  }
  try {
    await publish(name, value, { secret });

    return "stored";
  } catch {
    return "failed";
  }
}

/**
 * A credential the run had, and whether the project ended up holding it.
 */
export type CredentialRecovery = {
  /**
   * The variable, or `undefined` when there is no such credential in this run.
   */
  readonly name: CredentialVariable | undefined;
  readonly secret: boolean;

  /**
   * What became of it, or `undefined` when it was never sent.
   */
  readonly published: PublishState | undefined;
};

/**
 * The credentials the project did not receive — empty in the ordinary case,
 * where both were stored.
 *
 * @remarks
 * Typed, not rendered, for a caller that reports each as a command and as
 * `next_args`: it builds both from the same `variable set` input.
 *
 * @param credentials - Each credential of the run and what became of it.
 * @returns One entry per credential the project lacks.
 */
export function unpublished(credentials: readonly CredentialRecovery[]): readonly Unpublished[] {
  return credentials.flatMap((credential) => {
    const name = credential.name;
    if (name === undefined) {
      return [];
    }
    if (credential.published === undefined || credential.published === "stored") {
      return [];
    }

    return [{ name, secret: credential.secret }];
  });
}

/**
 * A credential the project lacks, which `variable set` puts there.
 */
export type Unpublished = {
  /**
   * The variable.
   */
  readonly name: CredentialVariable;

  /**
   * Whether it is a secret one.
   */
  readonly secret: boolean;
};

/**
 * The project variables a connection reads its credentials from.
 *
 * @remarks
 * A credential the file holds as a value names no variable, so it is
 * `undefined`: there is nothing to publish to.
 */
export type CredentialNames = {
  /**
   * The variable the client id is read from.
   */
  readonly clientId: ClientIdVariable | undefined;

  /**
   * The variable the client secret is read from.
   */
  readonly clientSecret: ClientSecretVariable | undefined;
};

/**
 * The credentials a run was given or asked for.
 */
export type GivenCredentials = {
  /**
   * Where the provider answers, when a development run named a stand-in.
   */
  readonly endpoints: ConnectionEndpoints | undefined;

  /**
   * The client id, when there is one.
   */
  readonly clientId: ClientId | undefined;

  /**
   * The client secret, when there is one.
   */
  readonly secret: ClientSecret | undefined;
};

/**
 * What became of each credential sent to the project.
 */
export type PublishedCredentials = {
  /**
   * Whether the client id reached the project, or `undefined` when it was not
   * sent.
   */
  readonly clientId: PublishState | undefined;

  /**
   * Where the client secret ended up, or `undefined` when it was not sent.
   */
  readonly secret: SecretOutcome | undefined;
};
