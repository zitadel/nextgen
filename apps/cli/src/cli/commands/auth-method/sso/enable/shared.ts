import type { FollowUps, SchemaTarget } from "@/cli/commands/auth-method/command";
import type { CommandResult, JsonEnvelope } from "@/lib/oclif";
import type { Connection as RemoteConnection } from "@/lib/oclif/types";
import type { Suggest, SuggestedCommand } from "@/lib/suggestion";
import type { Questions } from "@/lib/ui";
import type { Change, Connection, ConnectionSummary, DocumentChange } from "@/lib/zitadel";

import type { EnableFlags } from "@/cli/commands/auth-method/sso/enable";
import type { ProviderName } from "@zitadel/config/idp";
import type { CredentialNames, PublishedCredentials, PublishState, SecretOutcome } from "@/lib/idp";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";

/**
 * Nothing sent to the project, as a dry run reports it.
 */
export const NOTHING_PUBLISHED: PublishedCredentials = {
  clientId: undefined,
  secret: undefined,
};

/**
 * What a run of `auth-method sso enable` starts from.
 */
export type EnableInput = Readonly<{
  /**
   * The flags the command admitted.
   */
  flags: EnableFlags;
}>;

/**
 * What the run answers: the command's envelope.
 */
export type EnableAnswer = JsonEnvelope;

/**
 * What the command provides every step: the run's facts, and the parts of the
 * command that read the project, draw and answer, which stay in the command.
 */
export type EnableServices = Readonly<{
  /**
   * The project's directory.
   */
  cwd: string;

  /**
   * The run's environment variables.
   */
  env: NodeJS.ProcessEnv;

  /**
   * The questions the run may ask a person.
   */
  ask: Questions;

  /**
   * Builds the commands the run suggests.
   */
  suggest: Suggest;

  /**
   * Whether the run only previews.
   */
  dryRun: boolean;

  /**
   * Whether the run may not ask anything.
   */
  nonInteractive: boolean;

  /**
   * Whether this is a development build that may ask where a provider answers.
   */
  developmentBuild: boolean;

  /**
   * Reads the schema the run changes and everything around it.
   *
   * @param flags - The flags the command admitted.
   * @returns What the run read.
   */
  loadSchemaTarget(flags: EnableFlags): Promise<SchemaTarget>;

  /**
   * Resolves the project and server the run addresses.
   *
   * @returns The connection to them.
   */
  connect(): Promise<RemoteConnection>;

  /**
   * The run again without `--dry-run`, as the developer typed it.
   *
   * @returns The command.
   */
  realRun(): Promise<SuggestedCommand>;

  /**
   * Writes the change to the project's files.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @returns The files written.
   */
  write(target: SchemaTarget, change: Change): Promise<readonly string[]>;

  /**
   * Whether the run answers with JSON.
   */
  isJson: boolean;

  /**
   * The server the run addresses.
   */
  source: string;

  /**
   * Says what a configuration change did, and what else the developer would not
   * otherwise see.
   *
   * @param change - The change.
   */
  report(change: Change): void;

  /**
   * Answers with a result.
   *
   * @param result - The result to answer with.
   * @returns The envelope the command answers with.
   */
  emit(result: CommandResult): JsonEnvelope;

  /**
   * The arguments a suggested command is run with.
   *
   * @param command - The command.
   * @returns Its arguments.
   */
  argsOf(command: SuggestedCommand): readonly string[];

  /**
   * The commands to run after a change: what leads, then deploy when a file changed.
   *
   * @param changed - Whether a file changed.
   * @param leading - What comes first.
   * @returns The commands, and their arguments.
   */
  followUps(changed: boolean, leading?: readonly SuggestedCommand[]): FollowUps;
}>;

/**
 * What a run says about the connection it adds, before any credential is
 * asked for.
 */
export type Summary = {
  /**
   * The Project the run addresses. `--json` suppresses the console line that
   * otherwise carries it, and a result that names only the schema does not
   * say which Project was changed.
   */
  readonly projectId: string;

  /**
   * The provider, as a command line names it.
   */
  readonly provider: ProviderName;

  /**
   * The name a sign-in button and every message show for the provider.
   */
  readonly displayName: string;

  /**
   * The schema the provider is added to.
   */
  readonly schema: string;

  /**
   * The connection the schema lists: the one created, or the one reused.
   */
  readonly connection: Connection;

  /**
   * Whether the connection was already in the project.
   */
  readonly reused: boolean;

  /**
   * The redirect URI to register with the provider, on the Project's
   * development issuer.
   */
  readonly callbackUri: string;

  /**
   * The redirect URI on each primary origin, where a deploy lands the app.
   */
  readonly deployedCallbackUris: readonly string[];

  /**
   * The redirect URI pattern for each preview origin. A preview URL is one
   * pull-request build of the same app, so each needs its own entry at the
   * provider, and a wildcard pattern cannot be registered as one.
   */
  readonly previewCallbackUris: readonly string[];
};

/**
 * A credential's variable, and whether the project holds its value.
 */
type PublishedVariable = {
  readonly variable: string;
  readonly published: PublishState;
};

/**
 * What `payload` words the result's data from.
 */
type PayloadInput = {
  readonly summary: Summary;
  readonly change: DocumentChange<Connection>;
  readonly published: PublishedCredentials;
  readonly names: CredentialNames;
};

/**
 * The machine-readable result. Never the secret, only whether it is held.
 */
type Payload = {
  readonly project_id: string;
  readonly provider: ProviderName;
  readonly schema: string;
  readonly connection: {
    readonly action: "reuse" | "create";
    readonly slug: string;
    readonly file: string;
    readonly claim_mapping: Readonly<Record<string, string>>;
    readonly verified_claims: Readonly<Record<string, string | boolean>>;
    readonly scopes: readonly string[];
    readonly unmapped: ConnectionSummary["unmapped"];
    readonly used_by: readonly string[];
  };
  readonly callback_uri: string;
  readonly changed: readonly string[];
  readonly notices: Change["notices"];
  readonly client_id: PublishedVariable | null;
  readonly secret: PublishedVariable | null;
};

/**
 * The client id's variable and what became of it, for the result.
 *
 * @param names - The connection's variables.
 * @param published - What became of the client id, if it was sent.
 * @returns Both, or `null` when it was not sent or has no variable.
 */
function publishedClientId(
  names: CredentialNames,
  published: PublishState | undefined,
): PublishedVariable | null {
  if (published === undefined || names.clientId === undefined) {
    return null;
  }
  return {
    variable: names.clientId,
    published,
  };
}

/**
 * The client secret's variable and where it ended up, for the result.
 *
 * @param secret - Where the secret ended up, if it was sent.
 * @returns Both, or `null` when it was not sent.
 */
function storedSecret(secret: SecretOutcome | undefined): PublishedVariable | null {
  if (secret === undefined) {
    return null;
  }
  return {
    variable: secret.name,
    published: secret.published,
  };
}

/**
 * The machine-readable result. Never the secret, only whether it is held.
 *
 * @param input - The summary, the change, what became of each credential,
 *   and the variables they go to.
 * @returns The result's data.
 */
export function payload(input: PayloadInput): Payload {
  const summary = input.summary;
  const action = summary.reused ? "reuse" : "create";
  const mapped = input.change.after.connections.summarize(input.change.document);
  return {
    project_id: summary.projectId,
    provider: summary.provider,
    schema: summary.schema,
    connection: {
      action,
      slug: summary.connection.slug,
      file: summary.connection.path,
      claim_mapping: Object.fromEntries(
        mapped.mappings.map(({ property, claim }) => {
          return [property, claim];
        }),
      ),
      verified_claims: Object.fromEntries(
        mapped.verifications.map(({ property, claim }) => {
          return [property, claim];
        }),
      ),
      scopes: mapped.scopes,
      unmapped: mapped.unmapped,
      used_by: mapped.usedBy,
    },
    callback_uri: summary.callbackUri,
    changed: [...input.change.changedPaths],
    notices: input.change.notices,
    client_id: publishedClientId(input.names, input.published.clientId),
    secret: storedSecret(input.published.secret),
  };
}

/**
 * Print what the connection maps: which claim fills each user
 * attribute and what verifies it, the scopes it asks for, the attributes no
 * claim fills, the schemas that sign in through it, and where to change it.
 *
 * @remarks
 * Every value read from a file is escaped on its own, newlines included, so a
 * name cannot drive the terminal or forge a line of the notice.
 *
 * @param change - The change that adds the connection.
 */
export function drawMapping(change: DocumentChange<Connection>): void {
  const text = (value: string) => {
    return escapeControlCharacters(value, { keepLayout: false });
  };
  const connection = change.document;
  const { mappings, verifications, scopes, createsUsers, unmapped, usedBy } =
    change.after.connections.summarize(connection);
  const verifiedBy = new Map(
    verifications.flatMap(({ property, claim }): ReadonlyArray<readonly [string, string]> => {
      if (claim === true) {
        return [[property, "always counts as verified"]];
      }
      if (typeof claim === "string") {
        return [[property, `counts as verified when ${text(claim)} is true`]];
      }
      return [];
    }),
  );
  const sections = [
    mappings.length === 0
      ? []
      : [
          createsUsers
            ? `When someone signs in with ${text(connection.displayName)} for the first time, Zitadel fills in their new user like this:`
            : `${text(connection.displayName)} does not create users in Zitadel, so these claims are not used to fill one:`,
          ...mappings.map(({ property, claim }) => {
            const verified = verifiedBy.get(property) ?? "is not treated as verified";
            return [
              `- ${text(property)} comes from the provider's ${text(claim)} claim.`,
              `  It ${verified}.`,
            ].join("\n");
          }),
        ],
    scopes.length === 0
      ? []
      : [
          `Zitadel asks ${text(connection.displayName)} for these scopes: ${new Intl.ListFormat("en", { type: "conjunction" }).format(scopes.map(text))}.`,
        ],
    unmapped.length === 0
      ? []
      : [
          "These attributes have no claim yet:",
          ...unmapped.map(({ property, required }) => {
            if (!required) {
              return `- ${text(property)} is optional, so it can stay empty.`;
            }
            return createsUsers
              ? `- ${text(property)} is required, so sign-up will have to ask for it.`
              : `- ${text(property)} is required, but this connection does not create users.`;
          }),
        ],
    usedBy.length === 0
      ? []
      : [
          `This connection is used by ${new Intl.ListFormat("en", { type: "conjunction" }).format(usedBy.map(text))}, so a change here affects the people who sign in with it.`,
        ],
    [
      `To change which claim fills an attribute, edit claim_mapping in ${text(connection.path)} and run deploy.`,
    ],
  ].filter((section) => {
    return section.length > 0;
  });
  log.info(
    sections
      .flatMap((section, at) => {
        return at === 0 ? section : ["", ...section];
      })
      .join("\n"),
  );
}
