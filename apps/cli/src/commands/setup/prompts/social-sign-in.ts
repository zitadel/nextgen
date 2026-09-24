import { note, password, select, text } from "@clack/prompts";

import {
  clientSecretVariableName,
  idpCatalogEntry,
  IDP_PROVIDERS,
  type IdpCatalogEntry,
} from "@zitadel/config/idp-catalog";

import { callbackUriFor } from "../../../lib/idp";
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
    this.announce(entry, answers.devPort);

    const clientId =
      answers.sso?.clientId !== undefined && answers.sso.clientId !== ""
        ? answers.sso.clientId
        : await this.askClientId();
    const secret = answers.sso?.secret ?? (await this.askSecret(provider));
    return { ...answers, sso: { provider, clientId, secret } };
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
  private announce(entry: IdpCatalogEntry, devPort: number): void {
    note(
      [
        "Register an OAuth application at:",
        entry.console_url,
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
      validate: (value) => (value.trim() === "" ? "Enter the client id." : undefined),
    });
    bail(answer);
    return String(answer).trim();
  }

  /**
   * Empty is a deliberate answer: the connection is scaffolded either way and
   * the developer may prefer to set the value themselves later.
   */
  private async askSecret(provider: string): Promise<string | undefined> {
    const answer = await password({
      message: `Client secret (stored in .env.local as ${clientSecretVariableName(provider)}, Enter to skip)`,
    });
    bail(answer);
    const value = String(answer ?? "").trim();
    return value === "" ? undefined : value;
  }
}
