import { note, password, select, text } from "@clack/prompts";

import {
  clientSecretVariableName,
  idpCatalogEntry,
  IDP_PROVIDERS,
  type IdpCatalogEntry,
} from "@zitadel/config/idp-catalog";

import { askConnectionEndpoints, callbackUriFor } from "../../../lib/idp";
import { issuerFromPort } from "../../../lib/orca";

import { bail } from "./cancel";
import type { PromptContext, SetupAnswers, SetupPrompt } from "./types";

/**
 * Stands for "no provider". Empty rather than a word, so it can never collide
 * with a catalog key, and a string because clack options carry one.
 */
const NONE = "";

/**
 * "Add a social sign-in provider?" — the one onboarding question that needs
 * something from outside the terminal, so it asks last of the configuration
 * questions and takes "not now" as a first-class answer (#1081).
 *
 * Registering the OAuth application is the developer's to do and cannot be
 * automated, so the question announces what to register and where before
 * asking for anything back. Declining costs nothing: `sso enable` performs
 * exactly this journey on an existing Project, which is why this prompt
 * collects answers rather than doing any work — the scaffolding step writes
 * the connection, the schema and the flow in one place for both paths.
 *
 * `--sso` skips only the parts it answers. A flagged run that could not
 * supply the secret — it is never a flag, and only a scripted run pipes it in
 * — is still asked for it here, the way `--preset` skips its own question and
 * no other.
 */
export class SocialSignInPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    const provider = ctx.ssoFromFlag ? answers.sso?.provider : await this.chooseProvider();
    if (provider === undefined) {
      return answers;
    }

    const entry = idpCatalogEntry(provider);
    // Before the announcement, which names the vendor's console: on a
    // development build the provider may not be the vendor at all.
    const endpoints = answers.sso?.endpoints ?? (await askConnectionEndpoints({
        provider,
        developmentBuild: ctx.developmentBuild === true,
        command: "Setup",
      }));
    this.announce(entry, answers.devPort, endpoints?.issuer);

    const clientId =
      answers.sso?.clientId !== undefined && answers.sso.clientId !== ""
        ? answers.sso.clientId
        : await this.askClientId();
    const secret =
      answers.sso?.secret !== undefined && answers.sso.secret !== ""
        ? answers.sso.secret
        : await this.askSecret(provider);
    return { ...answers, sso: { provider, clientId, secret, endpoints } };
  }

  /** The provider, or `undefined` when the developer wants none. */
  private async chooseProvider(): Promise<string | undefined> {
    const chosen = await select({
      message: "Add a social sign-in provider?",
      initialValue: NONE,
      options: [
        {
          value: NONE,
          label: "Not now — email sign-in only",
          // Plain wording, not a quoted command line: a suggested command
          // belongs in `next_commands` (rendered through `publicCliCommand`,
          // which knows the installed version), and the contract test holds
          // that line.
          hint: "the sso enable command adds one later",
        },
        ...IDP_PROVIDERS.map((provider) => ({
          value: provider,
          label: `Continue with ${idpCatalogEntry(provider).display_name}`,
          hint: "needs an OAuth app you register with the provider",
        })),
      ],
    });
    bail(chosen);
    return String(chosen) === NONE ? undefined : String(chosen);
  }

  /**
   * Say what to register and where. The redirect URI is settled by now — the
   * port question runs before this one and the issuer derives from it — so it
   * can be shown rather than left for the developer to work out, which
   * matters because the vendor matches it literally.
   */
  private announce(entry: IdpCatalogEntry, devPort: number, issuer?: string): void {
    note(
      [
        // Where to register depends on who is actually answering: pointing a
        // developer at the vendor's console when the connection runs against
        // their own stand-in would be worse than saying nothing.
        ...(issuer === undefined
          ? ["Register an OAuth application at:", entry.console_url]
          : ["Register a client with the provider at:", issuer]),
        "",
        "Redirect URI:",
        callbackUriFor(issuerFromPort(devPort)),
      ].join("\n"),
      `${entry.display_name} sign-in`,
    );
  }


  private async askClientId(): Promise<string> {
    const answer = await text({
      message: "Client ID",
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => ((value ?? "").trim() === "" ? "Enter the client id." : undefined),
    });
    bail(answer);
    return String(answer).trim();
  }

  /**
   * Required, not skippable. By this point the developer has chosen a provider
   * and registered an OAuth application for it; a connection without the
   * secret is a button that fails at the provider with `invalid_client`, long
   * after setup reported success. "Not now" is answered by declining the
   * provider, which costs nothing — `sso enable` adds it later.
   *
   * The message names the project because that is the only place the value
   * goes: the connection references it as `${{ NAME }}`, the engine resolves
   * that from the project's variables, and nothing is written to disk.
   */
  private async askSecret(provider: string): Promise<string> {
    const answer = await password({
      message: `Client secret (published to the project as ${clientSecretVariableName(provider)})`,
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => ((value ?? "").trim() === "" ? "Enter the client secret." : undefined),
    });
    bail(answer);
    return String(answer).trim();
  }
}
