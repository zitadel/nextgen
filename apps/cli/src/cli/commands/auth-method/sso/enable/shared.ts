import type { ProviderName } from "@zitadel/config/idp";
import type { ReadonlyDeep } from "type-fest";

import type AuthMethodSsoEnable from "@/cli/commands/auth-method/sso/enable";
import type { CredentialNames, PublishedCredentials, PublishState } from "@/lib/idp";
import { log } from "@/lib/log";
import type { Admitted } from "@/lib/oclif";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Change, Connection, ConnectionSummary, DocumentChange } from "@/lib/zitadel";

/**
 * What a run of `auth-method sso enable` starts from.
 */
export type EnableInput = Readonly<{
  /**
   * The flags the command admitted.
   */
  flags: Admitted<typeof AuthMethodSsoEnable>["flags"];
}>;

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
 * A credential's variable, and whether the project holds its value.
 */
type PublishedVariable = Readonly<{
  variable: string;
  published: PublishState;
}>;

/**
 * What `payload` words the result's data from.
 */
type PayloadInput = Readonly<{
  summary: Summary;
  change: DocumentChange<Connection>;
  published: PublishedCredentials;
  names: CredentialNames;
}>;

/**
 * The machine-readable result. Never the secret, only whether it is held.
 */
type Payload = ReadonlyDeep<{
  project_id: string;
  provider: ProviderName;
  schema: string;
  connection: {
    action: "reuse" | "create";
    slug: string;
    file: string;
    claim_mapping: Record<string, string>;
    verified_claims: Record<string, string | boolean>;
    scopes: string[];
    unmapped: ConnectionSummary["unmapped"];
    used_by: string[];
  };
  callback_uri: string;
  changed: string[];
  notices: Change["notices"];
  client_id: PublishedVariable | null;
  secret: PublishedVariable | null;
}>;

/**
 * The machine-readable result. Never the secret, only whether it is held.
 *
 * @remarks
 * The client id appears only when it was sent and has a variable, and the secret
 * only when it was sent.
 *
 * @param input - The summary, the change, what became of each credential,
 *   and the variables they go to.
 * @returns The result's data.
 */
export function payload(input: PayloadInput): Payload {
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
  log.info(
    [
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
    ]
      .filter((section) => {
        return section.length > 0;
      })
      .flatMap((section, at) => {
        return at === 0 ? section : ["", ...section];
      })
      .join("\n"),
  );
}
