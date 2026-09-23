import { note, password, select, text } from "@clack/prompts";

import {
  clientSecretVariableName,
  idpCatalogEntry,
  IDP_PROVIDERS,
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
 * asking for anything back. Declining costs nothing: `sso enable`
 * performs exactly this journey on an existing Project, which is why this
 * prompt collects answers rather than doing any work — the scaffolding step
 * writes the connection, the schema and the flow in one place for both paths.
 */
export class SocialSignInPrompt implements SetupPrompt {
  async ask(answers: SetupAnswers, ctx: PromptContext): Promise<SetupAnswers> {
    if (ctx.ssoFromFlag) {
      return answers;
    }
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
    const provider = String(chosen);
    if (provider === NONE) {
      return answers;
    }

    const entry = idpCatalogEntry(provider);
    // The redirect URI is settled by now: the port question runs before this
    // one, and the issuer derives from it. Showing it beats making the
    // developer work it out, because the vendor matches it literally.
    note(
      [
        `Register an OAuth application at:`,
        entry.console_url,
        "",
        `Redirect URI:`,
        callbackUriFor(issuerFromPort(answers.devPort)),
      ].join("\n"),
      `${entry.display_name} sign-in`,
    );

    const clientId = await text({
      message: "Client ID",
      // Vendors format these differently, so only emptiness can be checked.
      validate: (value) => (value.trim() === "" ? "Enter the client id." : undefined),
    });
    bail(clientId);

    // Prompted, never a flag: a secret on a command line lands in shell
    // history, a process listing and CI logs. Empty is a real answer — the
    // connection is scaffolded either way and the value can be pasted into
    // .env.local afterwards.
    const secret = await password({
      message: `Client secret (stored in .env.local as ${clientSecretVariableName(provider)}, Enter to skip)`,
    });
    bail(secret);
    const value = String(secret ?? "").trim();

    return {
      ...answers,
      sso: {
        provider,
        clientId: String(clientId).trim(),
        secret: value === "" ? undefined : value,
      },
    };
  }
}
