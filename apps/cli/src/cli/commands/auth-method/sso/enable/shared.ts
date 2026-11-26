import type { LocalMachine } from "@/lib/server";
import type { IdpProvider, ProviderName, ProviderSelection } from "@zitadel/config/idp";

import type { FollowUps, SchemaTarget } from "@/cli/commands/auth-method/command";
import type AuthMethodSsoEnable from "@/cli/commands/auth-method/sso/enable";
import type { Origins } from "@/lib/backend";
import type {
  CredentialDelivery,
  CredentialNames,
  CredentialPrompt,
  GivenCredentials,
  ProviderChoice,
  PublishedCredentials,
} from "@/lib/idp";
import type { Admitted, CommandResult } from "@/cli/core";
import type { Connection as RemoteConnection } from "@/cli/core/types";
import type { Again, Suggest, SuggestedCommand } from "@/lib/suggestion";
import type { Refusal } from "@/cli/core/refusal";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Questions } from "@/lib/ui";
import type { Change, Connection, DocumentChange, SsoOptions } from "@/lib/zitadel";

/**
 * What more than one connection to the provider being enabled is refused for.
 */
export const CONNECTION_DUPLICATED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Keep the one this project should use and remove the others, then run the command again.",
  details: {
    provider: "{provider}",
    files: "{paths}",
  },
} as const satisfies Refusal;

/**
 * What more than one connection named by the slug being enabled is refused for.
 */
export const SLUG_DUPLICATED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "A slug names one connection. Remove or rename all but one, then run the command again.",
  details: {
    slug: "{slug}",
    files: "{paths}",
  },
} as const satisfies Refusal;

/**
 * What a new connection's file that is a connection with its slug to another
 * issuer is refused for.
 */
export const PROVIDER_MISMATCH_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Point it at the provider if it is that connection. Otherwise change its slug, in the file and in the schemas and flows that name it, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
  },
} as const satisfies Refusal;

/**
 * What a connection reading both credentials from one variable is refused for.
 */
export const CREDENTIALS_DOUBLED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Give client_id and client_secret separate ${{ NAME }} references, then run the command again.",
  details: {
    slug: "{slug}",
    variable: "{variable}",
  },
} as const satisfies Refusal;

/**
 * What two connections reading a credential from one variable are refused for.
 */
export const VARIABLE_SHARED_REFUSAL = {
  code: "E_CONFLICT",
  message: "{message}",
  hint: "Point one of them at a variable of its own, then run the command again.",
  details: {
    file: "{path}",
    slug: "{slug}",
    other_slug: "{otherSlug}",
    variable: "{variable}",
  },
} as const satisfies Refusal;

/**
 * What a step whose action is named like an outcome the edit writes is
 * refused for.
 */
export const ACTION_CLASH_REFUSAL = {
  message: "{message}",
  hint: 'Rename the action "{action}" on step "{step}" (and its transition), then run auth-method sso enable again.',
  details: {
    step: "{step}",
    action: "{action}",
  },
} as const satisfies Refusal;

/**
 * What a step whose legacy outcome declares a purpose or an action is refused
 * for.
 */
export const ROUTE_LOSS_REFUSAL = {
  message: "{message}",
  hint: 'Remove purpose and action from the transition "{transition}" on step "{step}", then run auth-method sso enable again.',
  details: {
    step: "{step}",
    transition: "{transition}",
  },
} as const satisfies Refusal;

/**
 * Joins a list the way a sentence does: "a, b and c".
 */
const CONJUNCTION = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * What a run says about the connection it adds, before any credential is
 * asked for.
 */
export type Summary = Readonly<{
  /**
   * The Project the run addresses. `--json` suppresses the console line that
   * otherwise carries it, and a result that names only the schema does not
   * say which Project was changed.
   */
  projectId: string;

  /**
   * The provider, as a command line names it.
   */
  provider: ProviderName;

  /**
   * The name a sign-in button and every message show for the provider.
   */
  displayName: string;

  /**
   * The schema the provider is added to.
   */
  schema: string;

  /**
   * The connection the schema lists: the one created, or the one reused.
   */
  connection: Connection;

  /**
   * Whether the connection was already in the project.
   */
  reused: boolean;

  /**
   * The redirect URI to register with the provider, on the Project's
   * development issuer.
   */
  callbackUri: string;

  /**
   * The redirect URI on each primary origin, where a deploy lands the app.
   */
  deployedCallbackUris: readonly string[];

  /**
   * The redirect URI pattern for each preview origin. A preview URL is one
   * pull-request build of the same app, so each needs its own entry at the
   * provider, and a wildcard pattern cannot be registered as one.
   */
  previewCallbackUris: readonly string[];
}>;

/**
 * Everything the steps of `auth-method sso enable` settle between them, by
 * name. A step reads some of it and adds some, as {@link Fact} says.
 */
export type EnableFacts = Readonly<{
  /**
   * The flags the command admitted.
   */
  flags: Admitted<typeof AuthMethodSsoEnable>["flags"];

  /**
   * How the flags choose a provider.
   */
  choice: ProviderChoice;

  /**
   * The origin the app serves from, which every callback URI is built on.
   */
  issuer: string;

  /**
   * What the run read: the schema it changes and everything around it.
   */
  target: SchemaTarget;

  /**
   * The connection to the project and server.
   */
  remote: RemoteConnection;

  /**
   * The origins the project serves, which name more callback URIs.
   */
  origins: Origins;

  /**
   * The provider, as it was chosen.
   */
  selection: ProviderSelection;

  /**
   * The provider's own facts.
   */
  provider: IdpProvider;

  /**
   * What the configuration is edited with.
   */
  options: SsoOptions;

  /**
   * The connection the provider's defaults make.
   */
  candidate: Connection;

  /**
   * The change worked out before anything was asked.
   */
  preview: DocumentChange<Connection>;

  /**
   * Where the credentials go, and how that is reported.
   */
  delivery: CredentialDelivery;

  /**
   * The questions that ask for the credentials.
   */
  prompt: CredentialPrompt;

  /**
   * What the run says about the connection.
   */
  summary: Summary;

  /**
   * The credentials the developer gave, and the endpoints a development run
   * answered.
   */
  given: GivenCredentials;

  /**
   * The change to write, checked to be accepted.
   */
  change: DocumentChange<Connection>;

  /**
   * What became of each credential.
   */
  published: PublishedCredentials;

  /**
   * The files written.
   */
  written: readonly string[];

  /**
   * The result the command answers with.
   */
  answer: CommandResult;
}>;

/**
 * The part of what is known that a step reads or adds, by name.
 *
 * @typeParam Key - The facts.
 */
export type Fact<Key extends keyof EnableFacts> = Pick<EnableFacts, Key>;

/**
 * What the command provides the steps: the run's settings, and the parts of the
 * command that read, write and word the result, which stay in the command.
 */
export type EnableServices = Readonly<{
  /**
   * What this machine knows about local servers.
   */
  machine: LocalMachine;

  /**
   * The server the run addresses.
   */
  source: string;

  /**
   * Stops the run when the person interrupts it.
   */
  signal: AbortSignal;

  /**
   * The project's directory.
   */
  cwd: string;

  /**
   * The run's environment variables.
   */
  env: Readonly<NodeJS.ProcessEnv>;

  /**
   * The questions the run may ask a person.
   */
  ask: Questions;

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
   * Builds the commands the run suggests.
   */
  suggest: Suggest;

  /**
   * This run again, with what changes, keeping everything it was given.
   */
  again: Again;

  /**
   * The arguments a suggested command is run with.
   *
   * @param command - The command.
   * @returns Its arguments.
   */
  argsOf(command: SuggestedCommand): readonly string[];

  /**
   * The run again without `--dry-run`, as the developer typed it.
   *
   * @returns The command.
   */
  realRun(): Promise<SuggestedCommand>;

  /**
   * Resolves the project and server the run addresses.
   *
   * @returns The connection to them.
   */
  connect(): Promise<RemoteConnection>;

  /**
   * Reads the schema the run changes and everything around it.
   *
   * @param flags - The flags the command admitted.
   * @returns What the run read.
   */
  loadSchemaTarget(flags: EnableFacts["flags"]): Promise<SchemaTarget>;

  /**
   * Says what a configuration change did, and what else the developer would not
   * otherwise see.
   *
   * @param change - The change.
   */
  report(change: Change): void;

  /**
   * What a change did, as the lines of a result.
   *
   * @param change - The change.
   * @param written - The files it wrote.
   * @returns The lines.
   */
  said(change: Change, written?: readonly string[]): string[];

  /**
   * Writes the change to the project's files.
   *
   * @param target - What the run read.
   * @param change - The change.
   * @returns The files written.
   */
  write(target: SchemaTarget, change: Change): Promise<readonly string[]>;

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
 * Escapes a value read from a file, newlines included, so it cannot drive the
 * terminal or forge a line of a notice.
 *
 * @param value - The value.
 * @returns The value, safe to print on one line.
 */
function plain(value: string): string {
  return escapeControlCharacters(value, { keepLayout: false });
}

/**
 * The machine-readable result. Never the secret, only whether it is held.
 *
 * @remarks
 * The client id appears only when it was sent and has a variable, and the secret
 * only when it was sent.
 *
 * @param input - The summary, the change, what became of each credential,
 *   and the variables they go to.
 * @param input.summary - What the run says about the connection.
 * @param input.change - The change that adds the connection.
 * @param input.published - What became of each credential.
 * @param input.names - The variables the credentials go to.
 * @returns The result's data.
 */
export function payload(
  input: Readonly<{
    summary: Summary;
    change: DocumentChange<Connection>;
    published: PublishedCredentials;
    names: CredentialNames;
  }>,
) {
  const mapped = input.change.after.connections.summarize(input.change.document);
  return {
    project_id: input.summary.projectId,
    provider: input.summary.provider,
    schema: input.summary.schema,
    connection: {
      action: input.summary.reused ? "reuse" : "create",
      slug: input.summary.connection.slug,
      file: input.summary.connection.path,
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
    callback_uri: input.summary.callbackUri,
    changed: [...input.change.changedPaths],
    notices: input.change.notices,
    client_id:
      input.published.clientId === undefined || input.names.clientId === undefined
        ? null
        : {
            variable: input.names.clientId,
            published: input.published.clientId,
          },
    secret:
      input.published.secret === undefined
        ? null
        : {
            variable: input.published.secret.name,
            published: input.published.secret.published,
          },
  };
}

/**
 * Word what the connection maps: which claim fills each user attribute and
 * what verifies it, the scopes it asks for, the attributes no claim fills, the
 * schemas that sign in through it, and where to change it.
 *
 * @remarks
 * Every value read from a file is escaped on its own, newlines included, so a
 * name cannot drive the terminal or forge a line of the notice.
 *
 * @param change - The change that adds the connection.
 * @returns The lines, with a blank line between each part.
 */
export function mappingLines(change: DocumentChange<Connection>): string[] {
  const connection = change.document;
  const { mappings, verifications, scopes, createsUsers, unmapped, usedBy } =
    change.after.connections.summarize(connection);
  const verifiedBy = new Map(
    verifications.flatMap(({ property, claim }): ReadonlyArray<readonly [string, string]> => {
      if (claim === true) {
        return [[property, "always counts as verified"]];
      }
      if (typeof claim === "string") {
        return [[property, `counts as verified when ${plain(claim)} is true`]];
      }
      return [];
    }),
  );
  return [
    mappings.length === 0
      ? []
      : [
          createsUsers
            ? `When someone signs in with ${plain(connection.displayName)} for the first time, Zitadel fills in their new user like this:`
            : `${plain(connection.displayName)} does not create users in Zitadel, so these claims are not used to fill one:`,
          ...mappings.map(({ property, claim }) => {
            const verified = verifiedBy.get(property) ?? "is not treated as verified";
            return [
              `- ${plain(property)} comes from the provider's ${plain(claim)} claim.`,
              `  It ${verified}.`,
            ].join("\n");
          }),
        ],
    scopes.length === 0
      ? []
      : [
          `Zitadel asks ${plain(connection.displayName)} for these scopes: ${CONJUNCTION.format(scopes.map(plain))}.`,
        ],
    unmapped.length === 0
      ? []
      : [
          "These attributes have no claim yet:",
          ...unmapped.map(({ property, required }) => {
            if (!required) {
              return `- ${plain(property)} is optional, so it can stay empty.`;
            }
            return createsUsers
              ? `- ${plain(property)} is required, so sign-up will have to ask for it.`
              : `- ${plain(property)} is required, but this connection does not create users.`;
          }),
        ],
    usedBy.length === 0
      ? []
      : [
          `This connection is used by ${CONJUNCTION.format(usedBy.map(plain))}, so a change here affects the people who sign in with it.`,
        ],
    [
      `To change which claim fills an attribute, edit claim_mapping in ${plain(connection.path)} and run deploy.`,
    ],
  ]
    .filter((section) => {
      return section.length > 0;
    })
    .flatMap((section, at) => {
      return at === 0 ? section : ["", ...section];
    });
}

/**
 * Words what the run addresses and what to register with the provider: the
 * schema edited, each callback URI, and where to create the application. The
 * wizard says it as it asks, and the result says it again for whoever reads
 * only the result.
 *
 * @remarks
 * A custom provider has no console to send the developer to: it is theirs, and
 * the issuer they gave is the only address known.
 *
 * @param needs - What was read and decided.
 * @returns The lines, one per statement.
 */
export function registrationLines(needs: Fact<"target" | "provider" | "summary">): string[] {
  const { schema } = needs.target;
  const { summary, provider } = needs;

  return [
    `Editing ${escapeControlCharacters(schema.path)}${schema.methods.length > 0 ? `, which offers ${escapeControlCharacters(schema.methods.join(", "))}` : ""}`,
    ...(summary.reused
      ? []
      : [
          `${escapeControlCharacters(provider.displayName, { keepLayout: false })} needs an OAuth application.`,
        ]),
    ...[summary.callbackUri, ...summary.deployedCallbackUris].map((uri) => {
      return `Callback URI   ${escapeControlCharacters(uri, { keepLayout: false })}`;
    }),
    ...(summary.previewCallbackUris.length > 0
      ? [
          "Each preview URL needs its own callback URI at the provider, since it takes no wildcards:",
          ...summary.previewCallbackUris.map((uri) => {
            return `  ${escapeControlCharacters(uri, { keepLayout: false })}`;
          }),
        ]
      : []),
    ...(summary.reused
      ? []
      : [
          provider.consoleUrl === undefined
            ? `Register it as a client at ${escapeControlCharacters(provider.issuer)}, with the callback URI above.`
            : `Create it at   ${escapeControlCharacters(provider.consoleUrl)}`,
        ]),
  ];
}
