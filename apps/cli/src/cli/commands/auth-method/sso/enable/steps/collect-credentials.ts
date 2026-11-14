import {
  type ClientId,
  type ConnectionEndpoints,
  idpProvider,
  parseClientId,
  parseClientSecret,
  parseIssuer,
  providerOf,
  selectionName,
} from "@zitadel/config/idp";

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { claimFlagTexts } from "@/lib/idp";
import { type FillIn, pipedFrom, type SuggestedCommand } from "@/lib/suggestion";
import { WizardStep } from "@/lib/wizard";

/**
 * What a suggested retry names where the client id is still to be given: the
 * one value there that is not a client id, so it is the reader's to replace.
 */
const CLIENT_ID_PLACEHOLDER = "<client-id>";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"flags" | "selection" | "claimRequest" | "preview" | "delivery">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "developmentBuild" | "suggest">;

/**
 * Asks for the client id and secret of the application registered with the
 * provider, once nothing is left that could refuse the run.
 *
 * @remarks
 * The secret never comes from a flag: it is asked for, or read from stdin when
 * scripting, so it cannot land in shell history, a process listing, or CI
 * logs.
 */
export class CollectCredentials extends WizardStep<"credentials", Fact<"given">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "credentials";

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
   * Ask for the credentials the connection needs, or take what the flags and
   * the pipe gave.
   *
   * @remarks
   * A new connection needs both: a sign-in button without them fails at the
   * provider, in a browser, not here. A reused one is given only what the
   * developer passes: the project may already hold its credentials, and an
   * unattended rerun should not start asking for them, so its secret is only
   * read to let a rerun replace one the project holds.
   *
   * A development run (`ZITADEL_CLI_DEV`) asks where the provider lives before
   * the credentials, because the provider may be a local stand-in and the
   * client is registered with whatever answers. Someone who installed the CLI
   * is configuring the real vendor and must never meet the question, so a
   * published build never sets the flag that gates it, and a custom connection,
   * whose issuer the developer has already given, is not asked. Only the issuer
   * is asked for and only the issuer is written: the engine accepts a
   * connection that names every endpoint or none at all, so naming two of the
   * four it needs is rejected as `idp.endpoints_partial`, and a stand-in serves
   * its own discovery document just as the vendor does. The issuer is
   * validated against the connection contract rather than merely parsed,
   * because `new URL` accepts `file:///tmp/idp`, which would be written to a
   * connection that then fails on apply.
   *
   * @param needs - The flags, the provider, the change, and where the
   *   credentials go.
   * @returns The credentials, and the endpoints a development run answered.
   */
  async run(needs: Needs): Promise<Fact<"given">> {
    const provider = providerOf(needs.selection);
    if (!needs.preview.created) {
      const secret = await this.deps.ask.secret({
        name: "client secret",
        message: `What is the client secret of your ${provider.displayName} OAuth app?`,
        parse: parseClientSecret,
        stdin: true,
        optional: true,
      });

      return {
        given: {
          endpoints: undefined,
          clientId: needs.flags.clientId,
          secret,
        },
      };
    }
    const endpoints: ConnectionEndpoints | undefined =
      needs.selection.kind === "catalog" && this.deps.developmentBuild
        ? {
            issuer: await this.deps.ask.text({
              name: "issuer",
              message: "What is the issuer URL of the provider?",
              parse: parseIssuer,
              initialValue: idpProvider(needs.selection.id).issuer,
            }),
          }
        : undefined;
    const clientId = await this.deps.ask.text({
      name: `client id for ${provider.displayName}`,
      message: `What is the client ID of your ${provider.displayName} OAuth app?`,
      flag: "--client-id",
      parse: parseClientId,
      given: needs.flags.clientId,
      retry: this.retryFor(needs, CLIENT_ID_PLACEHOLDER, false),
    });
    const secretVariable = needs.delivery.names.clientSecret;
    const secret = await this.deps.ask.secret({
      name: `client secret for ${secretVariable}`,
      message: `What is the client secret of your ${provider.displayName} OAuth app? It will be stored on the project as ${secretVariable}.`,
      parse: parseClientSecret,
      stdin: true,
      retry: this.retryFor(needs, clientId, true),
    });

    return {
      given: {
        endpoints,
        clientId,
        secret,
      },
    };
  }

  /**
   * What an agent can run once a missing credential is to hand. Only for a
   * catalog provider: a custom connection needs its settings repeated too.
   *
   * @remarks
   * The claims the run was given are repeated, because a rerun that dropped
   * them would create the connection with the defaults.
   *
   * @param needs - What the step reads.
   * @param clientId - The client id, or a placeholder for it.
   * @param piped - Whether the command reads the secret from `$CLIENT_SECRET` on stdin.
   * @returns The command, or `undefined` for a custom provider.
   */
  private retryFor(
    needs: Needs,
    clientId: ClientId | FillIn,
    piped: boolean,
  ): SuggestedCommand | undefined {
    if (needs.selection.kind !== "catalog") {
      return undefined;
    }
    const command = this.deps.suggest({
      id: "auth-method:sso:enable",
      flags: {
        provider: selectionName(needs.selection),
        clientId,
        ...claimFlagTexts(needs.claimRequest),
      },
    });

    return piped ? pipedFrom("CLIENT_SECRET", command) : command;
  }
}
