import { multiselect, note, password, text } from "@clack/prompts";
import {
  credentialVariables,
  idpProvider,
  IDP_PROVIDERS,
  type IdpProvider,
} from "@zitadel/config/idp";

import type { PromptContext, SetupAnswers, SetupPrompt, SsoAnswer } from "./types";

import { askConnectionEndpoints, callbackUriFor } from "../../../lib/idp";
import { issuerFromPort } from "../../../lib/orca";
import { bail } from "./cancel";

/**
 * "Add social sign-in providers?" — the one onboarding question that needs
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
    // `--sso` names the set; the wizard asks for it only when no flag did.
    const chosen = ctx.ssoFromFlag
      ? answers.sso.map((answer) => answer.provider)
      : await this.chooseProviders();
    if (chosen.length === 0) {
      return { ...answers, sso: [] };
    }

    // Asked per provider rather than once: each registers its own OAuth
    // application, so each has its own console, its own client id and its own
    // secret. A flagged run still gets asked for whatever the flags left out.
    const collected: SsoAnswer[] = [];
    for (const provider of chosen) {
      const flagged = answers.sso.find((answer) => answer.provider === provider);
      const entry = idpProvider(provider);
      // Before the announcement, which names the vendor's console: on a
      // development build the provider may not be the vendor at all.
      const endpoints =
        flagged?.endpoints ??
        (await askConnectionEndpoints({
          provider,
          developmentBuild: ctx.developmentBuild === true,
          command: "Setup",
        }));
      this.announce(entry, answers.devPort, endpoints?.issuer);

      const clientId =
        flagged?.clientId !== undefined && flagged.clientId !== ""
          ? flagged.clientId
          : await this.askClientId(entry);
      const secret =
        flagged?.secret !== undefined && flagged.secret !== ""
          ? flagged.secret
          : await this.askSecret(provider);
      collected.push({ provider, clientId, secret, endpoints });
    }
    return { ...answers, sso: collected };
  }

  /**
   * The providers to enable, empty when the developer wants none.
   *
   * A multi-select rather than one choice: a project may offer several at
   * once, and the schema and flow already carry `sso_providers` as a list.
   * `required: false` is what makes "none" an answer -- an explicit "not now"
   * option cannot coexist with ticking a provider beside it.
   */
  private async chooseProviders(): Promise<readonly string[]> {
    const chosen = await multiselect({
      message: "Add social sign-in providers?",
      // Nothing preselected, and declining costs nothing: `sso enable`
      // performs this journey on an existing Project later.
      required: false,
      options: IDP_PROVIDERS.map((provider) => ({
        value: provider,
        label: `Continue with ${idpProvider(provider).displayName}`,
        hint: "needs an OAuth app you register with the provider",
      })),
    });
    bail(chosen);
    return Array.isArray(chosen) ? chosen.map(String) : [];
  }

  /**
   * Say what to register and where. The redirect URI is settled by now — the
   * port question runs before this one and the issuer derives from it — so it
   * can be shown rather than left for the developer to work out, which
   * matters because the vendor matches it literally.
   */
  private announce(entry: IdpProvider, devPort: number, issuer?: string): void {
    note(
      [
        // Where to register depends on who is actually answering: pointing a
        // developer at the vendor's console when the connection runs against
        // their own stand-in would be worse than saying nothing.
        ...(issuer === undefined
          ? ["Register an OAuth application at:", entry.consoleUrl]
          : ["Register a client with the provider at:", issuer]),
        "",
        "Redirect URI:",
        callbackUriFor(issuerFromPort(devPort)),
      ].join("\n"),
      `${entry.displayName} sign-in`,
    );
  }

  private async askClientId(entry: IdpProvider): Promise<string> {
    const answer = await text({
      // Named, because several providers may be asked for in a row and an
      // unqualified "Client ID" three times over says nothing about which.
      message: `Client ID (${entry.displayName})`,
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
      message: `Client secret (published to the project as ${credentialVariables(provider).clientSecret})`,
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => ((value ?? "").trim() === "" ? "Enter the client secret." : undefined),
    });
    bail(answer);
    return String(answer).trim();
  }
}
