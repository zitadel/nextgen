import { consola } from "consola";

import { publicCliCommand } from "../public-cli";

/**
 * Publishes one variable to the project.
 *
 * Injected rather than built here: this module decides what becomes of a
 * captured credential, and giving it an API client as well would tie that
 * decision to the whole platform surface. Both callers already hold a
 * connection to the project they just addressed.
 */
export type SecretPublisher = (
  name: string,
  value: string,
  options: { readonly secret: boolean },
) => Promise<void>;

/** Whether a value reached the project's variables. */
export type PublishState = "stored" | "deferred" | "failed";

/** Where a captured client secret ended up, for the command's summary. */
export type SecretOutcome = {
  readonly name: string;

  /**
   * The project's variables — the only place a credential is written. The
   * connection document references it as `${{ NAME }}` and the engine resolves
   * that from the project's variables and from nowhere else, so a local server
   * and Zitadel Cloud both need the value here.
   *
   * `deferred` when there was no value to publish or no project to publish to;
   * `failed` when the platform refused the call. Neither is fatal — the
   * connection is written either way and `variables set` publishes it later.
   */
  readonly published: PublishState;
};

/**
 * Publish a client secret to the project.
 *
 * Nothing is written to disk. The value is a credential, the project stores it
 * encrypted under the project's own key (ADR 029), and no runtime reads it
 * from the environment — the token exchange happens on the server. A copy in
 * `.env.local` would be a credential sitting in the working tree for the
 * convenience of nobody, and one `git add -A` away from being published.
 *
 * Passing no value publishes nothing and is not an error: the developer may
 * intend to publish it themselves.
 */
export async function storeClientSecret(options: {
  readonly name: string;
  readonly value?: string;
  readonly publish?: SecretPublisher;
}): Promise<SecretOutcome> {
  const { name, value, publish } = options;
  if (value === undefined || value === "") {
    return { name, published: "deferred" };
  }
  return { name, published: await publishSecret(publish, name, value) };
}

/**
 * Publish the connection's client id.
 *
 * An ordinary variable, not a secret: the id travels in the browser's
 * authorize URL, so it is public by construction and hiding it would only cost
 * the developer the ability to read back what was configured.
 */
export async function publishClientId(options: {
  readonly name: string;
  readonly value: string;
  readonly publish?: SecretPublisher;
}): Promise<PublishState> {
  return publishSecret(options.publish, options.name, options.value, false);
}

/**
 * Send the value to the project, reporting a refusal instead of raising it.
 *
 * By the time this runs the connection document is already on disk and, in
 * `setup`, the whole project is provisioned. Failing the command there would
 * leave the developer with a half-written Project to clean up over something
 * one later command fixes, so the caller warns and points at `variables set`.
 */
async function publishSecret(
  publish: SecretPublisher | undefined,
  name: string,
  value: string,
  secret = true,
): Promise<PublishState> {
  if (publish === undefined) {
    return "deferred";
  }
  try {
    await publish(name, value, { secret });
    return "stored";
  } catch (error) {
    consola.debug(`Publishing ${name} to the project failed`, error);
    return "failed";
  }
}

/**
 * The command that puts a credential the project never received where the
 * connection looks for it.
 *
 * Shared so the warning printed to a terminal and the `next_commands` a JSON
 * run reports cannot drift apart — a JSON run prints no warnings at all, so
 * that list is the only place the recovery step appears.
 */
export function republishCommand(name: string, secret: boolean, cliVersion: string): string {
  // `--project-level` is not optional: every `variables` command refuses with
  // "Name the owner" without an owner, so a command missing it would fail
  // before it reached the API and repair nothing. The project level is also
  // the right owner — the engine resolves a connection's `${{ NAME }}` from
  // the project's own variables.
  return publicCliCommand(
    `variables set ${name} --project-level${secret ? " --secret" : ""}`,
    cliVersion,
  );
}

/** A credential, and whether the project ended up holding it. */
export type CredentialRecovery = {
  /** `undefined` when there is no such credential in this run at all. */
  readonly name: string | undefined;
  readonly secret: boolean;
  readonly published: PublishState | undefined;
};

/**
 * The commands that finish the job for every credential the project did not
 * receive — empty in the ordinary case, where both were stored.
 *
 * Built for a run that prints nothing: with `--json` consola is disabled, so
 * the warnings above never appear and this list is the only place the recovery
 * step is stated.
 */
export function republishCommands(
  credentials: readonly CredentialRecovery[],
  cliVersion: string,
): string[] {
  return credentials.flatMap(({ name, secret, published }) =>
    name !== undefined && published !== undefined && published !== "stored"
      ? [republishCommand(name, secret, cliVersion)]
      : [],
  );
}

/**
 * Say whether the project received a credential, and how to retry when it did
 * not. Shared by both credentials, because the project is the destination that
 * decides whether sign-in works and the wording should not drift between them.
 *
 * `noValue` separates the two ways a publish can be deferred: nothing was
 * supplied, or there was no project to publish to. They read the same to the
 * code and call for different things from the developer.
 */
function reportPublished(
  name: string,
  state: PublishState,
  republish: string,
  noValue: boolean,
): void {
  switch (state) {
    case "stored":
      consola.success(`Published ${name} to the project`);
      break;
    case "deferred":
      consola.warn(
        noValue
          ? `${name} has no value yet. Publish it with: ${republish}`
          : `${name} was not published to the project. Publish it with: ${republish}`,
      );
      break;
    case "failed":
      consola.warn(`${name} could not be published. Sign-in fails until it is: ${republish}`);
      break;
  }
}

/** Tell the developer what became of the secret. */
export function reportSecretOutcome(
  outcome: SecretOutcome,
  cliVersion: string,
  noValue: boolean,
): void {
  reportPublished(
    outcome.name,
    outcome.published,
    republishCommand(outcome.name, true, cliVersion),
    noValue,
  );
}

/**
 * Tell the developer what became of the client id.
 *
 * A missing one is never "no value yet": the command refuses without a client
 * id, so the only way here is a project it could not reach.
 */
export function reportClientIdOutcome(name: string, state: PublishState, cliVersion: string): void {
  reportPublished(name, state, republishCommand(name, false, cliVersion), false);
}
